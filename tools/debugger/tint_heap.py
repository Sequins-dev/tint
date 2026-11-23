"""Debugger-neutral core of Tint's heap tools (docs/native-heap-profiling.md).

The LLDB adapter (tools/lldb/tint.py) and the GDB adapter (tools/gdb/tint.py)
wrap a stopped process or core file in an *inferior* object and call into
this module, which reads the exported `__tint_heap_descriptor` (layout:
packages/abi/src/heap-debug.ts), walks the heap, writes raw dumps and
allocation samples for the Node tools (tools/heap-snapshot, tools/profiling),
drives allocation sampling and forced collections, and decodes values for
the adapters' formatters. Nothing here imports a debugger module.

An inferior provides:

    read(address, length) -> bytes          write(address, data)
    symbol_address(name) -> int | None      (load address of an ELF/Mach-O
                                             symbol, data or code)
    image_info() -> dict                    {path, loadAddress, fileAddress,
                                             slide, uuid} of the executable
    record_variables() -> [dict]            every `__tint_record.*` DWARF
                                             variable: {name, address, type}
                                             with `type` a struct description
    describe_type(name) -> dict | None      a named DWARF struct, described
    cache_key() -> hashable                 (executable, process) identity
    has_process(), is_stopped(), exit_status()
    is_core()                               whether memory comes from a core
                                             file (which may omit unmodified
                                             pages)
    selected_thread(), thread_by_id(id)
    resume()                                continue until the next stop or
                                             exit, synchronously
    break_at_address(name) -> id            a breakpoint on a symbol's first
                                             instruction
    break_at_function(qualified) -> [id]    breakpoints on functions named
                                             `...<qualified>` (optionally
                                             followed by " [suffix]")
    delete_breakpoint(id), disable_breakpoint(id)
    watch_writes(address, size) -> id, delete_watchpoint(id)

A thread provides `id`, `index`, `frames()` (innermost first; each frame has
pc, fp, sp, cfa (equal for the frames of one physical frame), function,
file, line, inlined and register(name) -> int, the register as unwound to
that frame), `register(name)` (frame 0), `write_register(name, int)`,
`save_registers(names)`, `restore_registers(saved)`, `stop_breakpoint()`
(the breakpoint id the thread stopped at, or None) and `stop_description()`.

A struct description is {name, size, fields: [{name, offset, type, class,
size[, target]}]} with LLDB-style type names (`object *`, `{x, y}`).
"""

import json
import os
import random
import struct
import time

DESCRIPTOR_SYMBOL = "__tint_heap_descriptor"
SAMPLE_SYMBOL = "__tint_allocation_sample"
THUNK_SYMBOL = "__tint_allocation_sample_thunk"
RECORD_PREFIX = "__tint_record."
# The generational collector's `collect` (snapshot points stop there).
COLLECT_FUNCTION = "generational.ts:collect"
MAGIC = b"TINTHEAP"
VERSION = 3
# Version 2 headers are one word: the marker (or record descriptor address)
# in the bits below FLAGS_SHIFT, the kind flags in the three bits above it.
FLAGS_SHIFT = 48
# Object layouts of the version 2+ header (packages/abi/src/host.ts).
LENGTH_OFFSET = 8
STRING_UNITS_OFFSET = 16
ARRAY_INLINE_OFFSET = 24
# Header word of a reference vector (kind marker 6, no flags).
VECTOR_HEADER = 6

GENERAL_TAGS = ["undefined", "number", "boolean", "string", "null", "object", "symbol", "bigint"]
STRING_LIMIT = 256
CHILD_LIMIT = 4096
GPR_NAMES = ["x%d" % i for i in range(29)] + ["fp", "lr", "sp", "pc"]
ARGUMENT_REGISTERS = ["x%d" % i for i in range(8)]
FLOAT_ARGUMENTS = ["d%d" % i for i in range(8)]


def split_header(word):
    """(marker, flags) of a version 2 header word."""
    return word & ((1 << FLAGS_SHIFT) - 1), (word >> FLAGS_SHIFT) & 7


class TintError(Exception):
    pass


def read_u64(inferior, address):
    return struct.unpack("<Q", inferior.read(address, 8))[0]


def read_u32(inferior, address):
    return struct.unpack("<I", inferior.read(address, 4))[0]


def write_u64(inferior, address, value):
    inferior.write(address, struct.pack("<Q", value))


def write_u32(inferior, address, value):
    inferior.write(address, struct.pack("<I", value))


class Descriptor(object):
    """The static part of `__tint_heap_descriptor` plus the live words it
    locates. Fields mirror packages/abi/src/heap-debug.ts."""

    def __init__(self, inferior):
        self.inferior = inferior
        address = inferior.symbol_address(DESCRIPTOR_SYMBOL)
        if address is None:
            raise TintError(
                "%s not found: build with --debug-symbols (heap introspection)"
                % DESCRIPTOR_SYMBOL
            )
        self.address = address
        fixed = inferior.read(address, 176)
        if fixed[0:8] != MAGIC:
            raise TintError("bad heap descriptor magic at 0x%x" % address)
        version, length = struct.unpack_from("<II", fixed, 8)
        if version != VERSION:
            raise TintError(
                "heap descriptor version %d is not supported (expected %d)"
                % (version, VERSION)
            )
        raw = inferior.read(address, length)
        self.raw = raw
        u32 = lambda offset: struct.unpack_from("<I", raw, offset)[0]
        u64 = lambda offset: struct.unpack_from("<Q", raw, offset)[0]
        self.version = version
        self.length = length
        self.context = u64(16)
        self.sample_interval = u64(24)
        self.sample_limit = u64(32)
        self.sample_count = u64(40)
        self.header_bytes = u32(48)
        self.granule = u32(52)
        self.marker_offset = u32(56)
        self.flags_shift = u32(60)
        self.max_kind_marker = u32(64)
        self.record_extent_offset = u32(68)
        self.record_references_offset = u32(72)
        self.record_index_before = u32(76)
        self.general_bytes = u32(80)
        self.general_reference_tags = u32(84)
        self.reference_encoding = u32(88)
        self.collector = u32(92)
        self.context_registry = u32(96)
        self.context_managed_base = u32(100)
        self.context_managed_bytes = u32(104)
        self.context_state = u32(108)
        self.state_index = {
            "youngTop": u32(112),
            "youngLimit": u32(116),
            "youngBase": u32(120),
            "oldTop": u32(124),
            "startBits": u32(128),
            "oldCapacity": u32(132),
            "dirtyBits": u32(136),
            "queueCount": u32(140),
            "largeChunks": u32(160),
            "largeCount": u32(164),
            "largeBase": u32(168),
            "largeGranule": u32(172),
        }
        count, table, pool, pool_bytes = u32(144), u32(148), u32(152), u32(156)
        names = raw[pool : pool + pool_bytes]
        self.kinds = []
        for index in range(count):
            at = table + index * 36
            words = struct.unpack_from("<9I", raw, at)
            end = names.index(b"\0", words[7])
            self.kinds.append(
                {
                    "marker": words[0],
                    "flags": words[1],
                    "fixedBytes": words[2],
                    "countOffset": None if words[3] == 0xFFFFFFFF else words[3],
                    "elementBytes": words[4],
                    "edges": words[5],
                    "referenceOffset": words[6],
                    "name": names[words[7] : end].decode("ascii"),
                    "minimumCount": words[8],
                }
            )
        self.state = None
        if self.context != 0:
            self._read_state()

    def _read_state(self):
        p, ctx = self.inferior, self.context
        self.registry = read_u64(p, ctx + self.context_registry)
        self.managed_base = read_u64(p, ctx + self.context_managed_base)
        self.managed_bytes = read_u64(p, ctx + self.context_managed_bytes)
        state = read_u64(p, ctx + self.context_state)
        self.state_address = state
        if state == 0:
            raise TintError("the runtime has not published its allocation state")
        word = lambda name: read_u32(p, state + 4 * self.state_index[name])
        dword = lambda name: read_u64(p, state + 4 * self.state_index[name])
        s = {
            "youngTop": word("youngTop"),
            "youngLimit": word("youngLimit"),
            "youngBaseOffset": word("youngBase"),
            "oldTop": word("oldTop"),
            "oldCapacity": word("oldCapacity"),
            "youngStartBits": dword("startBits"),
            "dirtyBits": dword("dirtyBits"),
            "queueCount": word("queueCount"),
            "largeChunks": dword("largeChunks"),
            "largeCount": word("largeCount"),
            "largeOffset": word("largeBase"),
            "largeGranule": word("largeGranule"),
        }
        s["largeBase"] = self.managed_base + s["largeOffset"]
        s["youngBase"] = self.managed_base + s["youngBaseOffset"]
        s["oldBase"] = s["youngBase"] - s["oldCapacity"]
        s["startBits"] = s["youngStartBits"] - s["oldCapacity"] // (self.granule * 8)
        # Unarmed, the limit is the nursery capacity; armed, the tool saved it.
        s["youngCapacity"] = (
            self.sample_limit if self.sample_interval != 0 and self.sample_limit else s["youngLimit"]
        )
        self.state = s

    def kind_for(self, marker, flags):
        for kind in self.kinds:
            if kind["marker"] == marker and kind["flags"] == flags:
                return kind
        return None

    def summary(self):
        out = {
            "descriptor": self.address,
            "version": self.version,
            "context": self.context,
            "sampleInterval": self.sample_interval,
            "sampleLimit": self.sample_limit,
            "sampleCount": self.sample_count,
            "headerBytes": self.header_bytes,
            "granule": self.granule,
            "flagsShift": self.flags_shift,
            "collector": self.collector,
            "kinds": self.kinds,
        }
        if self.state is not None:
            out.update(
                {
                    "registry": self.registry,
                    "managedBase": self.managed_base,
                    "managedBytes": self.managed_bytes,
                    "stateAddress": self.state_address,
                    "state": self.state,
                }
            )
        return out


def _granule_bits(descriptor, base, length):
    """The start bits covering [base, base + length) of the active space."""
    s = descriptor.state
    granule = descriptor.granule
    first = (base - s["oldBase"]) // granule
    count = (length + granule - 1) // granule
    start_byte = first // 8
    end_byte = (first + count + 7) // 8
    return first, descriptor.inferior.read(s["startBits"] + start_byte, end_byte - start_byte)


def _object_extent(descriptor, read_word, address, record_sizes):
    word = read_word(address + descriptor.marker_offset)
    marker = word & ((1 << descriptor.flags_shift) - 1)
    flags = (word >> descriptor.flags_shift) & 7
    granule = descriptor.granule
    if marker == 0:
        return None, "zero header"
    if marker <= descriptor.max_kind_marker:
        kind = descriptor.kind_for(marker, flags)
        if kind is None:
            return None, "unknown kind %d/%d" % (marker, flags)
        count = 0 if kind["countOffset"] is None else read_word(address + kind["countOffset"])
        size = kind["fixedBytes"] + max(count, kind["minimumCount"]) * kind["elementBytes"]
        return (size + granule - 1) // granule * granule, kind["name"]
    if marker % 8 != 0 or flags != 0:
        return None, "bad record header 0x%x/%d" % (marker, flags)
    size = record_sizes.get(marker)
    if size is None:
        size = read_word(marker + descriptor.record_extent_offset)
        record_sizes[marker] = size
    if size < descriptor.header_bytes or size % 8 != 0 or size > (1 << 32):
        return None, "bad record extent %d" % size
    return (size + granule - 1) // granule * granule, "record"


def large_objects(descriptor):
    """Object addresses of the large-object space's live chunks, ascending."""
    s = descriptor.state
    count = s["largeCount"]
    if count == 0 or s["largeChunks"] == 0:
        return []
    table = struct.unpack_from("<%dI" % count, descriptor.inferior.read(s["largeChunks"], 4 * count))
    return sorted(s["largeBase"] + start * s["largeGranule"] for start in table)


def verify_heap(descriptor):
    """Walks both spaces through the start bits and checks every header and
    extent: objects decode, stay inside their space and never overlap."""
    p = descriptor.inferior
    s = descriptor.state
    if s is None:
        raise TintError("no live context: the program is not running managed code")
    granule = descriptor.granule
    spaces = [("old", s["oldBase"], s["oldTop"]), ("young", s["youngBase"], s["youngTop"])]
    record_sizes = {}
    totals = {}
    for name, base, top in spaces:
        if top == 0:
            totals[name] = {"objects": 0, "bytes": 0, "kinds": {}}
            continue
        data = p.read(base, top)
        first, bits = _granule_bits(descriptor, base, top)

        def read_word(address, data=data, base=base):
            offset = address - base
            if 0 <= offset <= len(data) - 8:
                return struct.unpack_from("<Q", data, offset)[0]
            return read_u64(p, address)

        objects = 0
        walked = 0
        kinds = {}
        end_of_last = base
        units = top // granule
        for unit in range(units):
            bit = first + unit
            byte = bits[(bit // 8) - (first // 8)]
            if not (byte >> (bit & 7)) & 1:
                continue
            address = base + unit * granule
            if address < end_of_last:
                raise TintError("%s object 0x%x overlaps the previous one" % (name, address))
            size, label = _object_extent(descriptor, read_word, address, record_sizes)
            if size is None:
                raise TintError("%s object 0x%x: %s" % (name, address, label))
            if address + size > base + top:
                raise TintError("%s object 0x%x extends past the top" % (name, address))
            end_of_last = address + size
            objects += 1
            walked += size
            entry = kinds.setdefault(label, [0, 0])
            entry[0] += 1
            entry[1] += size
        totals[name] = {"objects": objects, "bytes": walked, "top": top, "kinds": kinds}
    # Large objects: one per chunk, never overlapping the next chunk.
    objects = 0
    walked = 0
    kinds = {}
    addresses = large_objects(descriptor)
    for index, address in enumerate(addresses):
        size, label = _object_extent(descriptor, lambda at: read_u64(p, at), address, record_sizes)
        if size is None:
            raise TintError("large object 0x%x: %s" % (address, label))
        if index + 1 < len(addresses) and address + size > addresses[index + 1]:
            raise TintError("large object 0x%x overlaps the next chunk" % address)
        objects += 1
        walked += size
        entry = kinds.setdefault(label, [0, 0])
        entry[0] += 1
        entry[1] += size
    totals["large"] = {"objects": objects, "bytes": walked, "kinds": kinds}
    return totals


# ---------------------------------------------------------------------------
# DWARF type table

_record_cache = {}


def record_types(inferior):
    """Descriptor load address -> {module, index, name, size, fields} from the
    `__tint_record.<module>.<index>` DWARF variables."""
    key = inferior.cache_key()
    if key in _record_cache:
        return _record_cache[key]
    table = {}
    for variable in inferior.record_variables():
        parts = variable["name"][len(RECORD_PREFIX) :].split(".")
        info = dict(variable["type"])
        info["module"] = parts[0]
        info["index"] = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
        table[variable["address"]] = info
    _record_cache[key] = table
    return table


def record_variable_name(info):
    """The DWARF variable describing a record_types() entry."""
    return RECORD_PREFIX + info["module"] + "." + (str(info["index"]) if info["index"] is not None else "function")


def kind_types(inferior, descriptor):
    out = {}
    for kind in descriptor.kinds:
        described = inferior.describe_type(kind["name"])
        if described is not None:
            out[kind["name"]] = described
    return out


# ---------------------------------------------------------------------------
# Raw dumps for tools/heap-snapshot


# Core files may omit pages that were never modified (LLDB's default
# macOS `process save-core` keeps modified memory only); such a page of
# anonymous memory still holds zeros, e.g. the start bits of unused old
# space.
ABSENT_PAGE = 4096


def _read_core_range(inferior, address, size):
    """Reads [address, address + size) of a core file, zero-filling pages
    the core does not hold; returns (data, zero-filled bytes)."""
    try:
        return inferior.read(address, size), 0
    except TintError:
        pass
    parts = []
    absent = 0
    at = address
    end = address + size
    while at < end:
        step = min(end, (at // ABSENT_PAGE + 1) * ABSENT_PAGE) - at
        try:
            parts.append(inferior.read(at, step))
        except TintError:
            parts.append(b"\0" * step)
            absent += step
        at += step
    return b"".join(parts), absent


def _dump_range(inferior, address, length, path):
    """Writes the memory range to path; returns the bytes a core file did
    not hold (written as zeros)."""
    chunk = 64 << 20
    absent = 0
    with open(path, "wb") as handle:
        offset = 0
        while offset < length:
            size = min(chunk, length - offset)
            if inferior.is_core():
                data, missing = _read_core_range(inferior, address + offset, size)
                absent += missing
            else:
                data = inferior.read(address + offset, size)
            handle.write(data)
            offset += size
    return absent


def frame_line(frame):
    return {
        "function": frame.function or "0x%x" % frame.pc,
        "file": frame.file,
        "line": frame.line,
    }


def thread_state(thread):
    frames = thread.frames()
    registers = {}
    if frames:
        for name in GPR_NAMES:
            try:
                registers[name] = frames[0].register(name)
            except TintError:
                pass
    return {
        "id": thread.id,
        "index": thread.index,
        "registers": registers,
        "frames": [
            {
                "pc": f.pc,
                "fp": f.fp,
                "sp": f.sp,
                "function": f.function or "",
                "file": f.file,
                "line": f.line,
                "inlined": f.inlined,
            }
            for f in frames
        ],
    }


def _stack_extent(inferior, start_fp, sp):
    """The highest frame record of the frame-pointer chain from start_fp."""
    top = max(start_fp, sp)
    fp = start_fp
    for _ in range(1000000):
        if fp == 0 or fp % 16 != 0:
            break
        try:
            caller = read_u64(inferior, fp)
        except TintError:
            break
        top = max(top, fp + 16)
        if caller == 0 or caller <= fp:
            break
        fp = caller
    return top


def dump_heap(descriptor, directory, thread, walk):
    """Writes meta.json, old.bin, young.bin, starts.bin, large.bin,
    stack.bin and registry.bin for the stopped `thread`. `walk` is {"start": frame
    pointer, "saves": [x19..x28] or None, "kind": "sample"|"registry"}."""
    inferior = descriptor.inferior
    s = descriptor.state
    if s is None:
        raise TintError("no live context: the program is not running managed code")
    state = thread_state(thread)
    os.makedirs(directory, exist_ok=True)
    started = time.time()
    absent = _dump_range(inferior, s["oldBase"], s["oldTop"], os.path.join(directory, "old.bin"))
    absent += _dump_range(inferior, s["youngBase"], s["youngTop"], os.path.join(directory, "young.bin"))
    granule = descriptor.granule
    bit_bytes = (s["oldCapacity"] + s["youngTop"] + granule * 8 - 1) // (granule * 8)
    absent += _dump_range(inferior, s["startBits"], bit_bytes, os.path.join(directory, "starts.bin"))
    # Large objects, concatenated in address order (meta "large" lists them).
    large = []
    with open(os.path.join(directory, "large.bin"), "wb") as handle:
        for address in large_objects(descriptor):
            size, label = _object_extent(descriptor, lambda at: read_u64(inferior, at), address, {})
            if size is None:
                raise TintError("large object 0x%x: %s" % (address, label))
            data, missing = _read_core_range(inferior, address, size)
            handle.write(data)
            absent += missing
            large.append({"address": address, "size": size})
    count = read_u64(inferior, descriptor.registry)
    registry_bytes = 32 + count * 24
    absent += _dump_range(inferior, descriptor.registry, registry_bytes, os.path.join(directory, "registry.bin"))
    sp = state["registers"].get("sp", 0)
    stack_top = _stack_extent(inferior, walk["start"], sp)
    stack_base = min(sp, walk["start"]) & ~15
    absent += _dump_range(inferior, stack_base, stack_top - stack_base, os.path.join(directory, "stack.bin"))
    # Stopped at the sample hook, the allocation it reports is not yet
    # initialized (the caller writes its header after the slow path).
    pending = None
    hook = inferior.symbol_address(SAMPLE_SYMBOL)
    if hook is not None and state["frames"] and state["frames"][0]["pc"] == hook:
        pending = {"address": state["registers"]["x0"], "size": state["registers"]["x1"]}
    meta = {
        "format": "tint-heap-dump",
        "pending": pending,
        "formatVersion": 3,
        "large": large,
        "time": time.time(),
        "image": inferior.image_info(),
        "descriptor": descriptor.summary(),
        "thread": state,
        "walk": walk,
        "stack": {"base": stack_base, "top": stack_top},
        "registryBytes": registry_bytes,
        # Bytes a core file did not hold, dumped as zeros.
        "absentBytes": absent,
        "records": {str(k): v for k, v in record_types(inferior).items()},
        "kindTypes": kind_types(inferior, descriptor),
        "dumpSeconds": time.time() - started,
    }
    with open(os.path.join(directory, "meta.json"), "w") as handle:
        json.dump(meta, handle)
    return meta


def _thunk_range(inferior):
    start = inferior.symbol_address(THUNK_SYMBOL)
    # The thunk is about 50 instructions; bound it generously for matching.
    return None if start is None else (start, start + 512)


def sample_walk(inferior, thread):
    """A precise root walk start under the allocation sampling thunk: a
    synthetic frame record returning into the thunk (a transparent range)
    whose frame returns into the allocating managed frame, which is at its
    allocation safepoint, with x19..x28 as they were when the thunk was
    entered (the debugger's unwound values for the thunk's frame). Valid at
    the sample hook and anywhere inside the slow path (e.g. a collection)."""
    bounds = _thunk_range(inferior)
    if bounds is None:
        raise TintError("%s not found (heap introspection is off)" % THUNK_SYMBOL)
    for index, frame in enumerate(thread.frames()):
        if bounds[0] <= frame.pc < bounds[1] and not frame.inlined:
            saves = [frame.register("x%d" % i) for i in range(19, 29)]
            return {
                "kind": "sample",
                "start": frame.fp,
                "returnAddress": frame.pc,
                "saves": saves,
                "thunkFrame": index,
            }
    raise TintError(
        "the thread is not inside an allocation slow path: stop at %s (tint-heap arm 1; continue)"
        % SAMPLE_SYMBOL
    )


def registry_walk(descriptor):
    """Walk start recorded by the collector's root-head read (valid while
    that collection's `collect` frame is live, e.g. at its last line)."""
    p = descriptor.inferior
    return {
        "kind": "registry",
        "start": read_u64(p, descriptor.registry + 16),
        "block": read_u64(p, descriptor.registry + 24),
        "saves": None,
    }


# ---------------------------------------------------------------------------
# Allocation sampling


def arm(descriptor, interval):
    """Arms (interval > 0) or disarms (0) allocation sampling."""
    p = descriptor.inferior
    d = descriptor.address
    s = descriptor.state
    if s is None:
        raise TintError("no live context: the program is not running managed code")
    limit_word = descriptor.state_address + 4 * descriptor.state_index["youngLimit"]
    saved = read_u64(p, d + 32)
    if saved == 0:
        saved = s["youngLimit"]
        write_u64(p, d + 32, saved)
    write_u64(p, d + 24, interval)
    if interval == 0:
        write_u32(p, limit_word, saved)
    else:
        write_u32(p, limit_word, min(saved, s["youngTop"] + interval))


def _parse_options(args, flags, values):
    options = {name: False for name in flags}
    options.update({name: None for name in values})
    index = 0
    while index < len(args):
        arg = args[index]
        if arg in flags:
            options[arg] = True
        elif arg in values and index + 1 < len(args):
            options[arg] = args[index + 1]
            index += 1
        else:
            raise TintError("unknown option %s" % arg)
        index += 1
    return options


def _numbers(text):
    return set(int(item) for item in text.split(",") if item) if text else set()


def _wait_for_context(inferior):
    """Runs until startup publishes the hosted context (a write watchpoint
    on the descriptor's context word); returns the descriptor."""
    descriptor = Descriptor(inferior)
    if descriptor.context != 0:
        return descriptor
    watch = inferior.watch_writes(descriptor.address + 16, 8)
    try:
        while True:
            inferior.resume()
            if not inferior.is_stopped():
                raise TintError("the program ended before publishing its heap")
            descriptor = Descriptor(inferior)
            if descriptor.context != 0:
                return descriptor
    finally:
        inferior.delete_watchpoint(watch)


def snapshot_points(descriptor, args):
    """tint-heap snapshot-points --out DIR [--before N,..] [--after N,..]
    [--after-majors] [--before-majors] [--peak] [--log FILE]

    Runs the (stopped) process to completion, dumping the heap before the
    listed collections (1-based; inside the slow path, live and dead
    objects), after them (at the first allocation once the collection
    returns: a precise safepoint) or after every major collection; --peak
    keeps one dump of the largest heap seen after a major."""
    options = _parse_options(
        args,
        ["--after-majors", "--before-majors", "--peak"],
        ["--out", "--before", "--after", "--log"],
    )
    out = options["--out"]
    if not out:
        raise TintError("--out is required")
    inferior = descriptor.inferior
    before = _numbers(options["--before"])
    after = _numbers(options["--after"])
    collect = inferior.break_at_function(COLLECT_FUNCTION)
    if not collect:
        raise TintError("no generational collect function (debug symbols?)")
    hook = inferior.break_at_address(SAMPLE_SYMBOL)
    log = []
    count = 0
    pending = None
    peak = 0
    dumps = []
    started = time.time()
    if inferior.is_stopped():
        descriptor = _wait_for_context(inferior)
    while True:
        inferior.resume()
        if not inferior.is_stopped():
            break
        thread = inferior.selected_thread()
        stopped = thread.stop_breakpoint()
        descriptor = Descriptor(inferior)
        state = descriptor.state
        if stopped in collect:
            count += 1
            entry = {
                "index": count,
                "time": time.time() - started,
                "youngTop": state["youngTop"],
                "oldTopBefore": state["oldTop"],
                "youngBaseBefore": state["youngBaseOffset"],
            }
            log.append(entry)
            if count in before or options["--before-majors"]:
                minor_possible = state["youngTop"] <= state["oldCapacity"] - state["oldTop"]
                if count in before or not minor_possible:
                    path = os.path.join(out, "before-%03d" % count)
                    dump_heap(descriptor, path, thread, sample_walk(inferior, thread))
                    dumps.append(path)
            arm(descriptor, 1)
            pending = entry
        elif stopped == hook and pending is not None:
            entry = pending
            pending = None
            entry["oldTopAfter"] = state["oldTop"]
            entry["major"] = state["youngBaseOffset"] != entry["youngBaseBefore"]
            wanted = entry["index"] in after or (entry["major"] and options["--after-majors"])
            if entry["major"] and options["--peak"] and state["oldTop"] > peak:
                peak = state["oldTop"]
                wanted = True
                label = "peak"
            else:
                label = "after-%03d" % entry["index"]
            if wanted:
                path = os.path.join(out, label)
                dump_heap(descriptor, path, thread, sample_walk(inferior, thread))
                entry["dump"] = path
                if path not in dumps:
                    dumps.append(path)
            arm(descriptor, 0)
        elif stopped == hook:
            arm(descriptor, 0)
        else:
            raise TintError("unexpected stop: %s" % thread.stop_description())
    exit_status = inferior.exit_status()
    summary = {
        "collections": count,
        "majors": sum(1 for entry in log if entry.get("major")),
        "dumps": dumps,
        "exitStatus": exit_status,
        "log": log,
    }
    os.makedirs(out, exist_ok=True)
    with open(options["--log"] or os.path.join(out, "collections.json"), "w") as handle:
        json.dump(summary, handle)
    return "TINTHEAP collections=%d majors=%d dumps=%d exit=%d" % (
        count,
        summary["majors"],
        len(dumps),
        exit_status,
    )


def stack_of(thread, first):
    """Physical frames from `first` outward, each with its inlined lines
    (leaf first), for pprof locations."""
    frames = []
    current = None
    for frame in thread.frames()[first:]:
        entry = frame_line(frame)
        if current is not None and current["pc"] == frame.pc and current["cfa"] == frame.cfa:
            current["lines"].append(entry)
        else:
            current = {"pc": frame.pc, "cfa": frame.cfa, "lines": [entry]}
            frames.append(current)
    for frame in frames:
        del frame["cfa"]
    return frames


def object_type_name(inferior, descriptor, address):
    """The kind or record name of the object at address, or None."""
    try:
        marker, flags = split_header(read_u64(inferior, address))
    except TintError:
        return None
    if marker == 0:
        return None
    if marker <= descriptor.max_kind_marker:
        kind = descriptor.kind_for(marker, flags)
        return kind["name"] if kind else None
    info = record_types(inferior).get(marker)
    return info["name"] if info else None


class _Interval(object):
    """Sampling intervals: exponentially distributed with the given mean,
    or fixed."""

    def __init__(self, interval, fixed, seed):
        self.interval = interval
        self.fixed = fixed
        self.rng = random.Random(seed)

    def next(self):
        if self.fixed:
            return self.interval
        return max(16, int(self.rng.expovariate(1.0 / self.interval)))


def _start_sampling(descriptor, first):
    if descriptor.context == 0:
        # Before startup: startup applies an interval written now.
        write_u64(descriptor.inferior, descriptor.address + 24, first)
    else:
        arm(descriptor, first)


def _pending_sample(thread, descriptor, frame):
    """A sample at a stop at the hook (its type is read at the next stop,
    once the allocation is initialized)."""
    address = frame.register("x0")
    s = descriptor.state
    return {
        "address": address,
        "size": frame.register("x1"),
        "young": s["youngBase"] <= address < s["youngBase"] + s["youngCapacity"],
        "youngBase": s["youngBaseOffset"],
        "youngTop": s["youngTop"],
        "stack": stack_of(thread, 2),  # below the hook and the thunk
    }


def _settle_sample(entry, descriptor):
    """Completes a pending sample with its type when the object is still
    where it was allocated (no collection moved it since)."""
    s = descriptor.state
    same_space = (
        s is not None
        and s["youngBaseOffset"] == entry["youngBase"]
        and ((entry["young"] and s["youngTop"] >= entry["youngTop"]) or not entry["young"])
    )
    entry["type"] = (
        object_type_name(descriptor.inferior, descriptor, entry["address"]) if same_space else None
    )
    del entry["youngBase"]
    del entry["youngTop"]
    return entry


def _samples_header(interval, fixed, image):
    return json.dumps(
        {"format": "tint-allocation-samples", "interval": interval, "fixed": fixed, "image": image}
    )


def sample(descriptor, args):
    """tint-heap sample --interval BYTES --out FILE [--max-samples N]
    [--seed N] [--fixed]

    Samples allocations until the process exits: arms sampling (an
    exponentially distributed interval with the given mean, unless --fixed),
    records the allocating stack at each __tint_allocation_sample stop and
    the object's type (read at the next stop, once initialized), and writes
    JSON lines for `node tools/heap-snapshot/cli.ts allocations`."""
    options = _parse_options(args, ["--fixed"], ["--interval", "--out", "--max-samples", "--seed"])
    interval = int(options["--interval"] or 0)
    out = options["--out"]
    if interval <= 0 or not out:
        raise TintError("--interval and --out are required")
    limit = int(options["--max-samples"] or 0)
    intervals = _Interval(interval, options["--fixed"], int(options["--seed"] or 1))
    inferior = descriptor.inferior
    hook = inferior.break_at_address(SAMPLE_SYMBOL)
    _start_sampling(descriptor, intervals.next())
    samples = 0
    pending = None
    started = time.time()
    with open(out, "w") as handle:
        handle.write(_samples_header(interval, bool(options["--fixed"]), inferior.image_info()) + "\n")
        while True:
            inferior.resume()
            if not inferior.is_stopped():
                break
            thread = inferior.selected_thread()
            if thread.stop_breakpoint() != hook:
                raise TintError("unexpected stop: %s" % thread.stop_description())
            descriptor = Descriptor(inferior)
            if pending is not None:
                handle.write(json.dumps(_settle_sample(pending, descriptor)) + "\n")
            pending = _pending_sample(thread, descriptor, thread.frames()[0])
            samples += 1
            if limit and samples >= limit:
                arm(descriptor, 0)
                handle.write(json.dumps(_settle_sample(pending, descriptor)) + "\n")
                pending = None
                inferior.disable_breakpoint(hook)
                continue
            write_u64(inferior, descriptor.address + 24, intervals.next())
        if pending is not None:
            pending["type"] = None
            del pending["youngBase"]
            del pending["youngTop"]
            handle.write(json.dumps(pending) + "\n")
    return "TINTHEAP samples=%d exit=%d seconds=%.1f" % (
        samples,
        inferior.exit_status(),
        time.time() - started,
    )


# ---------------------------------------------------------------------------
# Incremental allocation sampling (the DevTools bridge's HeapProfiler
# startSampling/stopSampling). The caller owns the breakpoint on the hook
# and continues the process itself; at each stop there it runs
# `tint-heap sample-record`. (LLDB breakpoint script callbacks are not used:
# with lldb-dap they can leave stop events unreported and continue requests
# blocking.)

_background = None


def background_record(descriptor):
    """At a stop at the sample hook: records the allocation's stack (its
    type at the next sample, once initialized) and draws the next
    interval."""
    state = _background
    if state is None:
        raise TintError("allocation sampling is not running")
    inferior = descriptor.inferior
    thread = inferior.selected_thread()
    frame = thread.frames()[0]
    hook = inferior.symbol_address(SAMPLE_SYMBOL)
    if hook is None or frame.pc != hook:
        raise TintError("sample-record needs a stop at %s" % SAMPLE_SYMBOL)
    _background_settle(descriptor)
    state["pending"] = _pending_sample(thread, descriptor, frame)
    state["samples"] += 1
    write_u64(inferior, descriptor.address + 24, state["intervals"].next())
    return "TINTHEAP sample %d" % state["samples"]


def _background_settle(descriptor):
    entry = _background["pending"]
    if entry is None:
        return
    _background["pending"] = None
    _background["records"].append(_settle_sample(entry, descriptor))


def background_start(descriptor, args):
    """tint-heap sample-start --interval BYTES [--seed N] [--fixed]: arms
    sampling; the caller stops at the hook and runs sample-record."""
    global _background
    if _background is not None:
        raise TintError("allocation sampling is already running")
    options = _parse_options(args, ["--fixed"], ["--interval", "--seed"])
    interval = int(options["--interval"] or 0)
    if interval <= 0:
        raise TintError("--interval is required")
    intervals = _Interval(interval, options["--fixed"], int(options["--seed"] or 1))
    _background = {
        "interval": interval,
        "fixed": bool(options["--fixed"]),
        "pending": None,
        "records": [],
        "samples": 0,
        "errors": [],
        "intervals": intervals,
        "image": descriptor.inferior.image_info(),
        "started": time.time(),
    }
    _start_sampling(descriptor, intervals.next())
    return "TINTHEAP sampling interval=%d" % interval


def _background_write(path):
    state = _background
    with open(path, "w") as handle:
        handle.write(_samples_header(state["interval"], state["fixed"], state["image"]) + "\n")
        for record in list(state["records"]):
            handle.write(json.dumps(record) + "\n")
    return "TINTHEAP samples=%d written=%d errors=%d" % (
        state["samples"],
        len(state["records"]),
        len(state["errors"]),
    )


def background_flush(args):
    """tint-heap sample-flush --out FILE: the samples so far (safe while
    the program runs: no process access)."""
    if _background is None:
        raise TintError("allocation sampling is not running")
    options = _parse_options(args, [], ["--out"])
    if not options["--out"]:
        raise TintError("--out is required")
    return _background_write(options["--out"])


def background_stop(inferior, args):
    """tint-heap sample-stop --out FILE: disarms (when the process is
    stopped) and writes every sample."""
    global _background
    if _background is None:
        raise TintError("allocation sampling is not running")
    options = _parse_options(args, [], ["--out"])
    state = _background
    if inferior is not None and inferior.has_process() and inferior.is_stopped():
        descriptor = Descriptor(inferior)
        if descriptor.context != 0:
            arm(descriptor, 0)
            _background_settle(descriptor)
        else:
            write_u64(inferior, descriptor.address + 24, 0)
    message = (
        _background_write(options["--out"]) if options["--out"] else "TINTHEAP samples=%d" % state["samples"]
    )
    _background = None
    return message


# ---------------------------------------------------------------------------
# Forced collection at a safepoint (the DevTools bridge's
# HeapProfiler.collectGarbage). The runtime's allocator treats request size
# 0 as a forced full collection. The tool reaches a safepoint by stopping at
# the entry of the allocation slow-path thunk (`tint-heap arm 1` sends the
# next allocation there), then performs a second call of the thunk with
# request 0 *before* the original one:
#
#   collect-begin  saves the argument registers, pushes a frame record
#                  {fp, lr} of the allocating frame below sp, points fp and
#                  sp at it, sets lr to the thunk's entry (a transparent
#                  range) and d0 to 0; continuing runs the thunk, which
#                  collects. The precise root walk passes through the
#                  transparent thunk frames to the pushed record, whose
#                  return address is the allocating frame's safepoint.
#   collect-end    at the return to the thunk entry (the same breakpoint),
#                  restores the argument registers, lr, fp and sp. x19-x28
#                  keep the collector's updates. Continuing performs the
#                  original allocation.

_collect = None


def collect_begin(descriptor):
    global _collect
    inferior = descriptor.inferior
    thunk = inferior.symbol_address(THUNK_SYMBOL)
    if thunk is None:
        raise TintError("%s not found (heap introspection is off)" % THUNK_SYMBOL)
    thread = inferior.selected_thread()
    if thread.register("pc") != thunk:
        raise TintError("collect-begin needs a stop at %s (tint-heap arm 1)" % THUNK_SYMBOL)
    if descriptor.context == 0:
        raise TintError("no live context")
    sp = thread.register("sp")
    fp = thread.register("fp")
    lr = thread.register("lr")
    saved = thread.save_registers(ARGUMENT_REGISTERS + FLOAT_ARGUMENTS)
    # The original request stays pending; disarm so neither call samples.
    arm(descriptor, 0)
    record = sp - 16
    inferior.write(record, struct.pack("<QQ", fp, lr))
    thread.write_register("d0", 0)
    thread.write_register("lr", thunk)
    thread.write_register("fp", record)
    thread.write_register("sp", record)
    _collect = {
        "thread": thread.id,
        "sp": sp,
        "fp": fp,
        "lr": lr,
        "saved": saved,
        "thunk": thunk,
        "old": descriptor.state["oldTop"],
        "young": descriptor.state["youngTop"],
    }
    return "TINTHEAP collect-begin sp=0x%x lr=0x%x" % (sp, lr)


def collect_end(descriptor):
    global _collect
    state = _collect
    if state is None:
        raise TintError("collect-end without collect-begin")
    inferior = descriptor.inferior
    thread = inferior.thread_by_id(state["thread"])
    pc = thread.register("pc")
    sp = thread.register("sp")
    if pc != state["thunk"] or sp != state["sp"] - 16:
        raise TintError("collect-end: not at the forced collection's return (pc 0x%x sp 0x%x)" % (pc, sp))
    status = thread.register("x0")
    thread.restore_registers(state["saved"])
    thread.write_register("lr", state["lr"])
    thread.write_register("fp", state["fp"])
    thread.write_register("sp", state["sp"])
    _collect = None
    after = Descriptor(inferior).state
    return "TINTHEAP collected status=%d old=%d->%d young=%d->%d" % (
        status,
        state["old"],
        after["oldTop"],
        state["young"],
        after["youngTop"],
    )


# ---------------------------------------------------------------------------
# Commands

USAGE = """tint-heap: Tint native heap tools (docs/native-heap-profiling.md)

    tint-heap info [--json]        the heap descriptor and current heap state
    tint-heap verify [--json]      walk every object through the start bits
    tint-heap dump <directory>     raw heap dump for tools/heap-snapshot
    tint-heap arm <bytes>          arm allocation sampling (0 disarms)
    tint-heap sample ...           drive allocation sampling (see --help)
    tint-heap snapshot-points ...  run to collections/samples and dump
    tint-heap sample-start ...     arm incremental sampling
    tint-heap sample-record        at a stop at the hook: record a sample
    tint-heap sample-flush --out F the samples so far (JSON lines)
    tint-heap sample-stop --out F  disarm and write the samples
    tint-heap collect-begin        at the slow-path thunk entry: force a
                                   major collection before the allocation
    tint-heap collect-end          at its return: resume the allocation

Everything is read through the exported `__tint_heap_descriptor` (layout:
packages/abi/src/heap-debug.ts) and DWARF, so the commands work on a live
process and on a core file."""


def _info_lines(descriptor):
    s = descriptor.state
    lines = [
        "heap descriptor v%d at 0x%x, context 0x%x, header %d B, granule %d B"
        % (descriptor.version, descriptor.address, descriptor.context, descriptor.header_bytes, descriptor.granule)
    ]
    if s is None:
        lines.append("no live context")
        return lines
    lines.append(
        "managed 0x%x + %d MiB, old 0x%x top %d / %d, young 0x%x top %d / %d, start bits 0x%x"
        % (
            descriptor.managed_base,
            descriptor.managed_bytes >> 20,
            s["oldBase"],
            s["oldTop"],
            s["oldCapacity"],
            s["youngBase"],
            s["youngTop"],
            s["youngCapacity"],
            s["startBits"],
        )
    )
    lines.append(
        "sampling interval %d (limit %d, %d samples)"
        % (descriptor.sample_interval, descriptor.sample_limit, descriptor.sample_count)
    )
    return lines


def command(inferior, args):
    """Runs one `tint-heap` command; returns its output text. `inferior` is
    None when the debugger has no process (a usage error for most verbs).
    Raises TintError on failure."""
    if not args or args[0] in ("help", "--help", "-h"):
        return USAGE
    verb = args[0]
    if verb == "sample-flush":
        return background_flush(args[1:])
    if verb == "sample-stop":
        return background_stop(inferior, args[1:])
    if inferior is None or not inferior.has_process():
        raise TintError("no process (launch, attach or load a core file)")
    descriptor = Descriptor(inferior)
    if verb == "info":
        if "--json" in args:
            return json.dumps(descriptor.summary())
        return "\n".join(_info_lines(descriptor))
    if verb == "verify":
        totals = verify_heap(descriptor)
        if "--json" in args:
            return json.dumps(totals)
        return "\n".join(
            "%s: %d objects, %d of %d bytes" % (name, entry["objects"], entry["bytes"], entry.get("top", 0))
            for name, entry in totals.items()
        )
    if verb == "dump":
        if len(args) < 2:
            raise TintError("usage: tint-heap dump <directory> [--registry]")
        thread = inferior.selected_thread()
        if "--registry" in args:
            walk = registry_walk(descriptor)
        else:
            walk = sample_walk(inferior, thread)
        meta = dump_heap(descriptor, args[1], thread, walk)
        return "dumped heap to %s in %.1fs" % (args[1], meta["dumpSeconds"])
    if verb == "arm":
        interval = int(args[1]) if len(args) > 1 else 0
        arm(descriptor, interval)
        return "allocation sampling interval %d" % interval
    if verb == "sample":
        return sample(descriptor, args[1:])
    if verb == "sample-start":
        return background_start(descriptor, args[1:])
    if verb == "sample-record":
        return background_record(descriptor)
    if verb == "collect-begin":
        return collect_begin(descriptor)
    if verb == "collect-end":
        return collect_end(descriptor)
    if verb == "snapshot-points":
        return snapshot_points(descriptor, args[1:])
    raise TintError("unknown tint-heap command %s" % verb)


# ---------------------------------------------------------------------------
# Value decoding for the adapters' formatters


def string_text(inferior, address, limit=STRING_LIMIT):
    """A string object's text as a JSON literal ("..." past the limit)."""
    if address == 0:
        return None
    length = read_u64(inferior, address + LENGTH_OFFSET)
    shown = min(length, limit)
    units = (
        struct.unpack("<%dH" % shown, inferior.read(address + STRING_UNITS_OFFSET, shown * 2)) if shown else ()
    )
    text = "".join(chr(u) if u < 0xD800 or u > 0xDFFF else "�" for u in units)
    return json.dumps(text, ensure_ascii=False) + ("..." if length > limit else "")


def object_kind(inferior, address):
    """What the header at address says the object is: (type name or None,
    label, record variable name or None). Built-in kinds name their DWARF
    structure; records name the `__tint_record.*` variable typed as them."""
    marker, flags = split_header(read_u64(inferior, address))
    if marker == 0:
        return None, "uninitialized", None
    if marker <= 7:
        name = None
        try:
            kind = Descriptor(inferior).kind_for(marker, flags)
            name = kind["name"] if kind else None
        except TintError:
            pass
        if name is None:
            return None, "kind %d/%d" % (marker, flags), None
        return name, name, None
    info = record_types(inferior).get(marker)
    if info is None:
        return None, "record @0x%x" % marker, None
    return None, info["name"], record_variable_name(info)


def vector_slots(inferior, address, length=None):
    """(index, word) of a reference vector's present slots up to capacity
    (or length): null slots are holes, and a slot holding the vector itself
    marks a present undefined (word 0 is returned for it)."""
    capacity = read_u64(inferior, address + LENGTH_OFFSET)
    count = min(capacity if length is None else min(length, capacity), CHILD_LIMIT)
    raw = inferior.read(address + ARRAY_INLINE_OFFSET, count * 8) if count else b""
    words = struct.unpack("<%dQ" % count, raw) if count else ()
    return [(index, 0 if word == address else word) for index, word in enumerate(words) if word != 0]


def number_list_values(inferior, values, present, length):
    """(index, number) of a number list's present elements."""
    count = min(length, read_u64(inferior, values + LENGTH_OFFSET), CHILD_LIMIT)
    flags = inferior.read(present + ARRAY_INLINE_OFFSET, count) if present else None
    raw = inferior.read(values + ARRAY_INLINE_OFFSET, count * 8) if count else b""
    out = []
    for index in range(count):
        if flags is not None and flags[index] != 1:
            continue
        out.append((index, struct.unpack_from("<d", raw, index * 8)[0]))
    return out


def is_dense_root(inferior, address):
    """Whether a list root is a reference vector (others are sparse trees)."""
    return read_u64(inferior, address) == VECTOR_HEADER


def general_text(inferior, tag, raw):
    """A general value's summary from its tag and payload word."""
    name = GENERAL_TAGS[tag] if tag < len(GENERAL_TAGS) else "tag %d" % tag
    if tag == 1:
        return repr(struct.unpack("<d", struct.pack("<Q", raw))[0])
    if tag == 2:
        return "true" if raw else "false"
    if tag == 3:
        return string_text(inferior, raw)
    if tag in (0, 4):
        return name
    if tag == 5 and raw:
        _, label, _ = object_kind(inferior, raw)
        return "%s 0x%x" % (label, raw)
    return "%s 0x%x" % (name, raw)


def payload_fields(field_names):
    """Payload fields only: header members are named "__..."."""
    return set(name for name in field_names if name and not name.startswith("__"))


def is_list_fields(fields):
    return fields == {"length", "root"}


def is_number_list_fields(fields):
    return fields == {"length", "values", "present"}


def is_entry_chain_fields(fields):
    return "head" in fields and "tail" in fields and ("size" in fields or "count" in fields)
