"""LLDB support for Tint native images (docs/native-heap-profiling.md).

    (lldb) command script import <tint checkout>/tools/lldb/tint.py

adds data formatters for Tint strings, reference vectors (lists), records,
Map/Set tables and tagged general values, and the `tint-heap` command:

    tint-heap info [--json]        the heap descriptor and current heap state
    tint-heap verify               walk every object through the start bits
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
process and on a core file (`lldb <image> -c <core>`; `process save-core`).
"""

import json
import os
import shlex
import struct
import sys
import time

import lldb

DESCRIPTOR_SYMBOL = "__tint_heap_descriptor"
SAMPLE_SYMBOL = "__tint_allocation_sample"
RECORD_PREFIX = "__tint_record."
MAGIC = b"TINTHEAP"
VERSION = 2
# Version 2 headers are one word: the marker (or record descriptor address)
# in the bits below FLAGS_SHIFT, the kind flags in the three bits above it.
FLAGS_SHIFT = 48
# Object layouts of the version 2 header (packages/abi/src/host.ts).
LENGTH_OFFSET = 8
STRING_UNITS_OFFSET = 16
ARRAY_INLINE_OFFSET = 24


def split_header(word):
    """(marker, flags) of a version 2 header word."""
    return word & ((1 << FLAGS_SHIFT) - 1), (word >> FLAGS_SHIFT) & 7


class TintError(Exception):
    pass


def _read(process, address, length):
    error = lldb.SBError()
    data = process.ReadMemory(address, length, error)
    if not error.Success() or data is None or len(data) != length:
        raise TintError("cannot read %d bytes at 0x%x: %s" % (length, address, error))
    return data


def _u64(process, address):
    return struct.unpack("<Q", _read(process, address, 8))[0]


def _u32(process, address):
    return struct.unpack("<I", _read(process, address, 4))[0]


def _write_u64(process, address, value):
    error = lldb.SBError()
    written = process.WriteMemory(address, struct.pack("<Q", value), error)
    if not error.Success() or written != 8:
        raise TintError("cannot write 0x%x: %s" % (address, error))


def _write_u32(process, address, value):
    error = lldb.SBError()
    written = process.WriteMemory(address, struct.pack("<I", value), error)
    if not error.Success() or written != 4:
        raise TintError("cannot write 0x%x: %s" % (address, error))


def _symbol_address(target, name):
    for kind in (lldb.eSymbolTypeData, lldb.eSymbolTypeCode, lldb.eSymbolTypeAny):
        found = target.FindSymbols(name, kind)
        for index in range(found.GetSize()):
            symbol = found.GetContextAtIndex(index).GetSymbol()
            if symbol.IsValid():
                address = symbol.GetStartAddress().GetLoadAddress(target)
                if address != lldb.LLDB_INVALID_ADDRESS:
                    return address
    return None


class Descriptor(object):
    """The static part of `__tint_heap_descriptor` plus the live words it
    locates. Fields mirror packages/abi/src/heap-debug.ts."""

    def __init__(self, target, process):
        self.target = target
        self.process = process
        address = _symbol_address(target, DESCRIPTOR_SYMBOL)
        if address is None:
            raise TintError(
                "%s not found: build with --debug-symbols (heap introspection)"
                % DESCRIPTOR_SYMBOL
            )
        self.address = address
        fixed = _read(process, address, 160)
        if fixed[0:8] != MAGIC:
            raise TintError("bad heap descriptor magic at 0x%x" % address)
        version, length = struct.unpack_from("<II", fixed, 8)
        if version != VERSION:
            raise TintError(
                "heap descriptor version %d is not supported (expected %d)"
                % (version, VERSION)
            )
        raw = _read(process, address, length)
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
        p, ctx = self.process, self.context
        self.registry = _u64(p, ctx + self.context_registry)
        self.managed_base = _u64(p, ctx + self.context_managed_base)
        self.managed_bytes = _u64(p, ctx + self.context_managed_bytes)
        state = _u64(p, ctx + self.context_state)
        self.state_address = state
        if state == 0:
            raise TintError("the runtime has not published its allocation state")
        word = lambda name: _u32(p, state + 4 * self.state_index[name])
        dword = lambda name: _u64(p, state + 4 * self.state_index[name])
        s = {
            "youngTop": word("youngTop"),
            "youngLimit": word("youngLimit"),
            "youngBaseOffset": word("youngBase"),
            "oldTop": word("oldTop"),
            "oldCapacity": word("oldCapacity"),
            "youngStartBits": dword("startBits"),
            "dirtyBits": dword("dirtyBits"),
            "queueCount": word("queueCount"),
        }
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


def _granule_bits(process, descriptor, base, length):
    """The start bits covering [base, base + length) of the active space."""
    s = descriptor.state
    granule = descriptor.granule
    first = (base - s["oldBase"]) // granule
    count = (length + granule - 1) // granule
    start_byte = first // 8
    end_byte = (first + count + 7) // 8
    return first, _read(process, s["startBits"] + start_byte, end_byte - start_byte)


def _object_extent(descriptor, read_u64, address, record_sizes):
    word = read_u64(address + descriptor.marker_offset)
    marker = word & ((1 << descriptor.flags_shift) - 1)
    flags = (word >> descriptor.flags_shift) & 7
    granule = descriptor.granule
    if marker == 0:
        return None, "zero header"
    if marker <= descriptor.max_kind_marker:
        kind = descriptor.kind_for(marker, flags)
        if kind is None:
            return None, "unknown kind %d/%d" % (marker, flags)
        count = 0 if kind["countOffset"] is None else read_u64(address + kind["countOffset"])
        size = kind["fixedBytes"] + max(count, kind["minimumCount"]) * kind["elementBytes"]
        return (size + granule - 1) // granule * granule, kind["name"]
    if marker % 8 != 0 or flags != 0:
        return None, "bad record header 0x%x/%d" % (marker, flags)
    size = record_sizes.get(marker)
    if size is None:
        size = read_u64(marker + descriptor.record_extent_offset)
        record_sizes[marker] = size
    if size < descriptor.header_bytes or size % 8 != 0 or size > (1 << 32):
        return None, "bad record extent %d" % size
    return (size + granule - 1) // granule * granule, "record"


def verify_heap(debugger, descriptor, out):
    """Walks both spaces through the start bits and checks every header and
    extent: objects decode, stay inside their space and never overlap."""
    p = descriptor.process
    s = descriptor.state
    granule = descriptor.granule
    spaces = [("old", s["oldBase"], s["oldTop"]), ("young", s["youngBase"], s["youngTop"])]
    record_sizes = {}
    totals = {}
    for name, base, top in spaces:
        if top == 0:
            totals[name] = {"objects": 0, "bytes": 0, "kinds": {}}
            continue
        data = _read(p, base, top)
        first, bits = _granule_bits(p, descriptor, base, top)

        def read_u64(address, data=data, base=base):
            offset = address - base
            if 0 <= offset <= len(data) - 8:
                return struct.unpack_from("<Q", data, offset)[0]
            return _u64(p, address)

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
            size, label = _object_extent(descriptor, read_u64, address, record_sizes)
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
    return totals


# ---------------------------------------------------------------------------
# DWARF type table

_type_cache = {}


def _type_class(sbtype):
    cls = sbtype.GetTypeClass()
    if cls == lldb.eTypeClassPointer:
        return "pointer"
    if cls in (lldb.eTypeClassStruct, lldb.eTypeClassClass):
        return "struct"
    if cls == lldb.eTypeClassUnion:
        return "union"
    if cls == lldb.eTypeClassArray:
        return "array"
    if cls == lldb.eTypeClassEnumeration:
        return "enum"
    return "base"


def _describe_struct(sbtype):
    fields = []
    for index in range(sbtype.GetNumberOfFields()):
        member = sbtype.GetFieldAtIndex(index)
        mtype = member.GetType()
        entry = {
            "name": member.GetName(),
            "offset": member.GetOffsetInBytes(),
            "type": mtype.GetName(),
            "class": _type_class(mtype),
            "size": mtype.GetByteSize(),
        }
        if entry["class"] == "pointer":
            entry["target"] = mtype.GetPointeeType().GetName()
        fields.append(entry)
    return {"name": sbtype.GetName(), "size": sbtype.GetByteSize(), "fields": fields}


def record_types(target):
    """Descriptor load address -> {module, index, name, size, fields} from the
    `__tint_record.<module>.<index>` DWARF variables."""
    process = target.GetProcess()
    key = (target.GetExecutable().fullpath, process.GetProcessID() if process.IsValid() else 0)
    if key in _type_cache:
        return _type_cache[key]
    found = target.FindGlobalVariables(
        "^" + RECORD_PREFIX.replace(".", "\\."), 1 << 20, lldb.eMatchTypeRegex
    )
    table = {}
    for index in range(found.GetSize()):
        # Formatters would read the (absent) memory and drop the location.
        value = found.GetValueAtIndex(index).GetNonSyntheticValue()
        name = value.GetName()
        # The DWARF location (DW_OP_addr) is known without reading memory:
        # cores need not contain the image's pages.
        location = value.GetLocation() or ""
        try:
            address = int(location, 16)
        except ValueError:
            sbaddress = value.GetAddress()
            address = sbaddress.GetLoadAddress(target)
            if address == lldb.LLDB_INVALID_ADDRESS:
                address = sbaddress.GetFileAddress()
        parts = name[len(RECORD_PREFIX) :].split(".")
        info = _describe_struct(value.GetType())
        info["module"] = parts[0]
        info["index"] = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
        table[address] = info
    _type_cache[key] = table
    return table


def kind_types(target, descriptor):
    out = {}
    for kind in descriptor.kinds:
        sbtype = target.FindFirstType(kind["name"])
        if sbtype.IsValid():
            out[kind["name"]] = _describe_struct(sbtype)
    return out


# ---------------------------------------------------------------------------
# Raw dumps for tools/heap-snapshot

def _dump_range(process, address, length, path):
    chunk = 64 << 20
    with open(path, "wb") as handle:
        offset = 0
        while offset < length:
            size = min(chunk, length - offset)
            handle.write(_read(process, address + offset, size))
            offset += size


def _image_info(target):
    module = target.GetModuleAtIndex(0)
    header = module.GetObjectFileHeaderAddress()
    load = header.GetLoadAddress(target)
    file_address = header.GetFileAddress()
    return {
        "path": module.GetFileSpec().fullpath,
        "loadAddress": load,
        "fileAddress": file_address,
        "slide": load - file_address,
        "uuid": module.GetUUIDString(),
    }


def _thread_state(thread, target):
    frame = thread.GetFrameAtIndex(0)
    registers = {}
    for name in ["x%d" % i for i in range(29)] + ["fp", "lr", "sp", "pc"]:
        value = frame.FindRegister(name)
        if value.IsValid():
            registers[name] = value.GetValueAsUnsigned()
    frames = []
    for index in range(thread.GetNumFrames()):
        f = thread.GetFrameAtIndex(index)
        line = f.GetLineEntry()
        frames.append(
            {
                "pc": f.GetPC(),
                "fp": f.GetFP(),
                "sp": f.GetSP(),
                "function": f.GetDisplayFunctionName() or f.GetFunctionName() or "",
                "file": line.GetFileSpec().fullpath if line.IsValid() else None,
                "line": line.GetLine() if line.IsValid() else 0,
                "inlined": f.IsInlined(),
            }
        )
    return {"id": thread.GetThreadID(), "index": thread.GetIndexID(), "registers": registers, "frames": frames}


def _stack_extent(process, start_fp, sp):
    """The highest frame record of the frame-pointer chain from start_fp."""
    top = max(start_fp, sp)
    fp = start_fp
    for _ in range(1000000):
        if fp == 0 or fp % 16 != 0:
            break
        try:
            caller = _u64(process, fp)
        except TintError:
            break
        top = max(top, fp + 16)
        if caller == 0 or caller <= fp:
            break
        fp = caller
    return top


def dump_heap(debugger, descriptor, directory, thread, walk):
    """Writes meta.json, old.bin, young.bin, starts.bin, stack.bin and
    registry.bin. `walk` is {"start": frame pointer, "saves": [x19..x28] or
    None, "kind": "sample"|"registry"}."""
    process = descriptor.process
    target = descriptor.target
    s = descriptor.state
    os.makedirs(directory, exist_ok=True)
    started = time.time()
    _dump_range(process, s["oldBase"], s["oldTop"], os.path.join(directory, "old.bin"))
    _dump_range(process, s["youngBase"], s["youngTop"], os.path.join(directory, "young.bin"))
    granule = descriptor.granule
    bit_bytes = (s["oldCapacity"] + s["youngTop"] + granule * 8 - 1) // (granule * 8)
    _dump_range(process, s["startBits"], bit_bytes, os.path.join(directory, "starts.bin"))
    count = _u64(process, descriptor.registry)
    registry_bytes = 32 + count * 24
    _dump_range(process, descriptor.registry, registry_bytes, os.path.join(directory, "registry.bin"))
    sp = thread["registers"].get("sp", 0)
    stack_top = _stack_extent(process, walk["start"], sp)
    stack_base = min(sp, walk["start"]) & ~15
    _dump_range(process, stack_base, stack_top - stack_base, os.path.join(directory, "stack.bin"))
    # Stopped at the sample hook, the allocation it reports is not yet
    # initialized (the caller writes its header after the slow path).
    pending = None
    top = process.GetSelectedThread().GetFrameAtIndex(0)
    hook = _symbol_address(process.GetTarget(), SAMPLE_SYMBOL)
    if hook is not None and top.GetPC() == hook:
        pending = {
            "address": top.FindRegister("x0").GetValueAsUnsigned(),
            "size": top.FindRegister("x1").GetValueAsUnsigned(),
        }
    meta = {
        "format": "tint-heap-dump",
        "pending": pending,
        "formatVersion": 2,
        "time": time.time(),
        "image": _image_info(target),
        "descriptor": descriptor.summary(),
        "thread": thread,
        "walk": walk,
        "stack": {"base": stack_base, "top": stack_top},
        "registryBytes": registry_bytes,
        "records": {str(k): v for k, v in record_types(target).items()},
        "kindTypes": kind_types(target, descriptor),
        "dumpSeconds": time.time() - started,
    }
    with open(os.path.join(directory, "meta.json"), "w") as handle:
        json.dump(meta, handle)
    return meta


THUNK_SYMBOL = "__tint_allocation_sample_thunk"


def _thunk_range(target):
    start = _symbol_address(target, THUNK_SYMBOL)
    # The thunk is about 50 instructions; bound it generously for matching.
    return None if start is None else (start, start + 512)


def sample_walk(process, thread):
    """A precise root walk start under the allocation sampling thunk: a
    synthetic frame record returning into the thunk (a transparent range)
    whose frame returns into the allocating managed frame, which is at its
    allocation safepoint, with x19..x28 as they were when the thunk was
    entered (LLDB's unwound values for the thunk's frame). Valid at the
    sample hook and anywhere inside the slow path (e.g. a collection)."""
    target = process.GetTarget()
    bounds = _thunk_range(target)
    if bounds is None:
        raise TintError("%s not found (heap introspection is off)" % THUNK_SYMBOL)
    for index in range(thread.GetNumFrames()):
        frame = thread.GetFrameAtIndex(index)
        pc = frame.GetPC()
        if bounds[0] <= pc < bounds[1] and not frame.IsInlined():
            saves = [frame.FindRegister("x%d" % i).GetValueAsUnsigned() for i in range(19, 29)]
            return {
                "kind": "sample",
                "start": frame.GetFP(),
                "returnAddress": pc,
                "saves": saves,
                "thunkFrame": index,
            }
    raise TintError(
        "the thread is not inside an allocation slow path: stop at %s (tint-heap arm 1; continue)"
        % SAMPLE_SYMBOL
    )


def registry_walk(process, descriptor):
    """Walk start recorded by the collector's root-head read (valid while
    that collection's `collect` frame is live, e.g. at its last line)."""
    return {
        "kind": "registry",
        "start": _u64(process, descriptor.registry + 16),
        "block": _u64(process, descriptor.registry + 24),
        "saves": None,
    }


# ---------------------------------------------------------------------------
# Allocation sampling

def arm(descriptor, interval):
    """Arms (interval > 0) or disarms (0) allocation sampling."""
    p = descriptor.process
    d = descriptor.address
    s = descriptor.state
    if s is None:
        raise TintError("no live context: the program is not running managed code")
    limit_word = descriptor.state_address + 4 * descriptor.state_index["youngLimit"]
    saved = _u64(p, d + 32)
    if saved == 0:
        saved = s["youngLimit"]
        _write_u64(p, d + 32, saved)
    _write_u64(p, d + 24, interval)
    if interval == 0:
        _write_u32(p, limit_word, saved)
    else:
        _write_u32(p, limit_word, min(saved, s["youngTop"] + interval))


# ---------------------------------------------------------------------------
# Commands

def _context(debugger):
    target = debugger.GetSelectedTarget()
    process = target.GetProcess()
    if not process.IsValid():
        raise TintError("no process (launch, attach or load a core file)")
    return target, process


def _print_info(result, descriptor):
    s = descriptor.state
    result.AppendMessage(
        "heap descriptor v%d at 0x%x, context 0x%x, header %d B, granule %d B"
        % (descriptor.version, descriptor.address, descriptor.context, descriptor.header_bytes, descriptor.granule)
    )
    if s is None:
        result.AppendMessage("no live context")
        return
    result.AppendMessage(
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
    result.AppendMessage(
        "sampling interval %d (limit %d, %d samples)"
        % (descriptor.sample_interval, descriptor.sample_limit, descriptor.sample_count)
    )


def heap_command(debugger, command, result, internal_dict):
    args = shlex.split(command)
    try:
        if not args or args[0] in ("help", "--help", "-h"):
            result.AppendMessage(__doc__)
            return
        if args[0] == "sample-flush":
            result.AppendMessage(_background_flush(args[1:]))
            return
        if args[0] == "sample-stop":
            result.AppendMessage(_background_stop(debugger, args[1:]))
            return
        target, process = _context(debugger)
        descriptor = Descriptor(target, process)
        verb = args[0]
        if verb == "info":
            if "--json" in args:
                result.AppendMessage(json.dumps(descriptor.summary()))
            else:
                _print_info(result, descriptor)
        elif verb == "verify":
            totals = verify_heap(debugger, descriptor, result)
            if "--json" in args:
                result.AppendMessage(json.dumps(totals))
            else:
                for name, entry in totals.items():
                    result.AppendMessage(
                        "%s: %d objects, %d of %d bytes"
                        % (name, entry["objects"], entry["bytes"], entry.get("top", 0))
                    )
        elif verb == "dump":
            if len(args) < 2:
                raise TintError("usage: tint-heap dump <directory> [--registry]")
            thread = process.GetSelectedThread()
            if "--registry" in args:
                walk = registry_walk(process, descriptor)
            else:
                walk = sample_walk(process, thread)
            meta = dump_heap(debugger, descriptor, args[1], _thread_state(thread, target), walk)
            result.AppendMessage("dumped heap to %s in %.1fs" % (args[1], meta["dumpSeconds"]))
        elif verb == "arm":
            interval = int(args[1]) if len(args) > 1 else 0
            arm(descriptor, interval)
            result.AppendMessage("allocation sampling interval %d" % interval)
        elif verb == "sample":
            from_sampler = _sampler_main(debugger, descriptor, args[1:])
            result.AppendMessage(from_sampler)
        elif verb == "sample-start":
            result.AppendMessage(_background_start(debugger, descriptor, args[1:]))
        elif verb == "sample-record":
            result.AppendMessage(_background_record(descriptor))
        elif verb == "collect-begin":
            result.AppendMessage(_collect_begin(descriptor))
        elif verb == "collect-end":
            result.AppendMessage(_collect_end(descriptor))
        elif verb == "snapshot-points":
            result.AppendMessage(_snapshot_points(debugger, descriptor, args[1:]))
        else:
            raise TintError("unknown tint-heap command %s" % verb)
    except TintError as error:
        result.SetError(str(error))


COLLECT_PATTERN = r"generational\.ts:collect( |$)"


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


def _stop_breakpoint(thread):
    if thread.GetStopReason() != lldb.eStopReasonBreakpoint:
        return None
    return thread.GetStopReasonDataAtIndex(0)


def _wait_for_context(target, process):
    """Runs until startup publishes the hosted context (a write watchpoint
    on the descriptor's context word); returns the descriptor."""
    descriptor = Descriptor(target, process)
    if descriptor.context != 0:
        return descriptor
    error = lldb.SBError()
    watch = target.WatchAddress(descriptor.address + 16, 8, False, True, error)
    if not error.Success():
        raise TintError("cannot watch the heap descriptor: %s" % error)
    try:
        while True:
            process.Continue()
            if process.GetState() != lldb.eStateStopped:
                raise TintError("the program ended before publishing its heap")
            descriptor = Descriptor(target, process)
            if descriptor.context != 0:
                return descriptor
    finally:
        target.DeleteWatchpoint(watch.GetID())


def _snapshot_points(debugger, descriptor, args):
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
    target = descriptor.target
    process = descriptor.process
    debugger.SetAsync(False)
    before = _numbers(options["--before"])
    after = _numbers(options["--after"])
    collect = target.BreakpointCreateByRegex(COLLECT_PATTERN)
    hook = target.BreakpointCreateByName(SAMPLE_SYMBOL)
    if collect.GetNumLocations() == 0:
        raise TintError("no generational collect function (debug symbols?)")
    log = []
    count = 0
    pending = None
    peak = 0
    dumps = []
    started = time.time()
    if process.GetState() == lldb.eStateStopped:
        descriptor = _wait_for_context(target, process)
    while True:
        process.Continue()
        if process.GetState() != lldb.eStateStopped:
            break
        thread = process.GetSelectedThread()
        stopped = _stop_breakpoint(thread)
        descriptor = Descriptor(target, process)
        state = descriptor.state
        if stopped == collect.GetID():
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
                    label = "before-%03d" % count
                    path = os.path.join(out, label)
                    dump_heap(debugger, descriptor, path, _thread_state(thread, target), sample_walk(process, thread))
                    dumps.append(path)
            arm(descriptor, 1)
            pending = entry
        elif stopped == hook.GetID() and pending is not None:
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
                meta = dump_heap(
                    debugger, descriptor, path, _thread_state(thread, target), sample_walk(process, thread)
                )
                entry["dump"] = path
                if path not in dumps:
                    dumps.append(path)
            arm(descriptor, 0)
        elif stopped == hook.GetID():
            arm(descriptor, 0)
        else:
            raise TintError("unexpected stop: %s" % thread.GetStopDescription(200))
    summary = {
        "collections": count,
        "majors": sum(1 for entry in log if entry.get("major")),
        "dumps": dumps,
        "exitStatus": process.GetExitStatus(),
        "state": process.GetState(),
        "log": log,
    }
    os.makedirs(out, exist_ok=True)
    with open(options["--log"] or os.path.join(out, "collections.json"), "w") as handle:
        json.dump(summary, handle)
    return "TINTHEAP collections=%d majors=%d dumps=%d exit=%d" % (
        count,
        summary["majors"],
        len(dumps),
        process.GetExitStatus(),
    )


def _stack_of(thread, first):
    """Physical frames from `first` outward, each with its inlined lines
    (leaf first), for pprof locations."""
    frames = []
    current = None
    for index in range(first, thread.GetNumFrames()):
        frame = thread.GetFrameAtIndex(index)
        line = frame.GetLineEntry()
        entry = {
            "function": frame.GetDisplayFunctionName() or frame.GetFunctionName() or "0x%x" % frame.GetPC(),
            "file": line.GetFileSpec().fullpath if line.IsValid() else None,
            "line": line.GetLine() if line.IsValid() else 0,
        }
        if current is not None and current["pc"] == frame.GetPC() and current["cfa"] == frame.GetCFA():
            current["lines"].append(entry)
        else:
            current = {"pc": frame.GetPC(), "cfa": frame.GetCFA(), "lines": [entry]}
            frames.append(current)
    for frame in frames:
        del frame["cfa"]
    return frames


def _object_type_name(target, process, descriptor, address):
    try:
        marker, flags = split_header(_u64(process, address))
    except TintError:
        return None
    if marker == 0:
        return None
    if marker <= descriptor.max_kind_marker:
        kind = descriptor.kind_for(marker, flags)
        return kind["name"] if kind else None
    info = record_types(target).get(marker)
    return info["name"] if info else None


def _sampler_main(debugger, descriptor, args):
    """tint-heap sample --interval BYTES --out FILE [--max-samples N]
    [--seed N] [--fixed]

    Samples allocations until the process exits: arms sampling (an
    exponentially distributed interval with the given mean, unless --fixed),
    records the allocating stack at each __tint_allocation_sample stop and
    the object's type (read at the next stop, once initialized), and writes
    JSON lines for `node tools/heap-snapshot/cli.ts allocations`."""
    import random

    options = _parse_options(args, ["--fixed"], ["--interval", "--out", "--max-samples", "--seed"])
    interval = int(options["--interval"] or 0)
    out = options["--out"]
    if interval <= 0 or not out:
        raise TintError("--interval and --out are required")
    limit = int(options["--max-samples"] or 0)
    rng = random.Random(int(options["--seed"] or 1))
    target = descriptor.target
    process = descriptor.process
    debugger.SetAsync(False)
    hook = target.BreakpointCreateByName(SAMPLE_SYMBOL)
    if hook.GetNumLocations() == 0:
        raise TintError("%s not found" % SAMPLE_SYMBOL)

    def next_interval():
        if options["--fixed"]:
            return interval
        return max(16, int(rng.expovariate(1.0 / interval)))

    first = next_interval()
    if descriptor.context == 0:
        # Before startup: startup applies an interval written now.
        _write_u64(process, descriptor.address + 24, first)
    else:
        arm(descriptor, first)
    samples = 0
    pending = None
    started = time.time()
    with open(out, "w") as handle:
        handle.write(json.dumps({"format": "tint-allocation-samples", "interval": interval,
                                 "fixed": bool(options["--fixed"]), "image": _image_info(target)}) + "\n")

        def flush(entry, descriptor):
            if entry is None:
                return
            state = descriptor.state
            same_space = state["youngBaseOffset"] == entry["youngBase"] and (
                (entry["young"] and state["youngTop"] >= entry["youngTop"]) or not entry["young"]
            )
            if same_space:
                entry["type"] = _object_type_name(target, process, descriptor, entry["address"])
            del entry["youngBase"]
            del entry["youngTop"]
            handle.write(json.dumps(entry) + "\n")

        while True:
            process.Continue()
            if process.GetState() != lldb.eStateStopped:
                break
            thread = process.GetSelectedThread()
            if _stop_breakpoint(thread) != hook.GetID():
                raise TintError("unexpected stop: %s" % thread.GetStopDescription(200))
            descriptor = Descriptor(target, process)
            flush(pending, descriptor)
            frame = thread.GetFrameAtIndex(0)
            address = frame.FindRegister("x0").GetValueAsUnsigned()
            size = frame.FindRegister("x1").GetValueAsUnsigned()
            state = descriptor.state
            young = state["youngBase"] <= address < state["youngBase"] + state["youngCapacity"]
            walk_start = 2  # hook, thunk
            pending = {
                "address": address,
                "size": size,
                "young": young,
                "youngBase": state["youngBaseOffset"],
                "youngTop": state["youngTop"],
                "stack": _stack_of(thread, walk_start),
            }
            samples += 1
            if limit and samples >= limit:
                arm(descriptor, 0)
                flush(pending, descriptor)
                pending = None
                hook.SetEnabled(False)
                continue
            _write_u64(process, descriptor.address + 24, next_interval())
        if pending is not None:
            pending["type"] = None
            del pending["youngBase"]
            del pending["youngTop"]
            handle.write(json.dumps(pending) + "\n")
    return "TINTHEAP samples=%d exit=%d seconds=%.1f" % (samples, process.GetExitStatus(), time.time() - started)


# ---------------------------------------------------------------------------
# Incremental allocation sampling (the DevTools bridge's HeapProfiler
# startSampling/stopSampling). The bridge owns the breakpoint on the hook
# and continues the process itself; at each stop there it runs
# `tint-heap sample-record`. (LLDB breakpoint script callbacks are not used:
# with lldb-dap they can leave stop events unreported and continue requests
# blocking.)

_background = None


def _background_record(descriptor):
    """At a stop at the sample hook: records the allocation's stack (its
    type at the next sample, once initialized) and draws the next
    interval."""
    state = _background
    if state is None:
        raise TintError("allocation sampling is not running")
    process = descriptor.process
    thread = process.GetSelectedThread()
    frame = thread.GetFrameAtIndex(0)
    hook = _symbol_address(descriptor.target, SAMPLE_SYMBOL)
    if hook is None or frame.GetPC() != hook:
        raise TintError("sample-record needs a stop at %s" % SAMPLE_SYMBOL)
    state["flush"](descriptor)
    address = frame.FindRegister("x0").GetValueAsUnsigned()
    size = frame.FindRegister("x1").GetValueAsUnsigned()
    s = descriptor.state
    young = s["youngBase"] <= address < s["youngBase"] + s["youngCapacity"]
    state["pending"] = {
        "address": address,
        "size": size,
        "young": young,
        "youngBase": s["youngBaseOffset"],
        "youngTop": s["youngTop"],
        "stack": _stack_of(thread, 2),
    }
    state["samples"] += 1
    _write_u64(process, descriptor.address + 24, state["next"]())
    return "TINTHEAP sample %d" % state["samples"]


def _background_start(debugger, descriptor, args):
    """tint-heap sample-start --interval BYTES [--seed N] [--fixed]: arms
    sampling; the caller stops at the hook and runs sample-record."""
    import random

    global _background
    if _background is not None:
        raise TintError("allocation sampling is already running")
    options = _parse_options(args, ["--fixed"], ["--interval", "--seed"])
    interval = int(options["--interval"] or 0)
    if interval <= 0:
        raise TintError("--interval is required")
    rng = random.Random(int(options["--seed"] or 1))
    target = descriptor.target
    process = descriptor.process

    def next_interval():
        if options["--fixed"]:
            return interval
        return max(16, int(rng.expovariate(1.0 / interval)))

    records = []

    def flush(current):
        entry = _background["pending"] if _background else None
        if entry is None:
            return
        _background["pending"] = None
        s = current.state
        same_space = s is not None and s["youngBaseOffset"] == entry["youngBase"] and (
            (entry["young"] and s["youngTop"] >= entry["youngTop"]) or not entry["young"]
        )
        entry["type"] = _object_type_name(target, process, current, entry["address"]) if same_space else None
        del entry["youngBase"]
        del entry["youngTop"]
        records.append(entry)

    _background = {
        "interval": interval,
        "fixed": bool(options["--fixed"]),
        "pending": None,
        "records": records,
        "samples": 0,
        "errors": [],
        "flush": flush,
        "next": next_interval,
        "image": _image_info(target),
        "started": time.time(),
    }
    first = next_interval()
    if descriptor.context == 0:
        _write_u64(process, descriptor.address + 24, first)
    else:
        arm(descriptor, first)
    return "TINTHEAP sampling interval=%d" % interval


def _background_write(path):
    state = _background
    with open(path, "w") as handle:
        handle.write(json.dumps({"format": "tint-allocation-samples", "interval": state["interval"],
                                 "fixed": state["fixed"], "image": state["image"]}) + "\n")
        for record in list(state["records"]):
            handle.write(json.dumps(record) + "\n")
    return "TINTHEAP samples=%d written=%d errors=%d" % (state["samples"], len(state["records"]), len(state["errors"]))


def _background_flush(args):
    """tint-heap sample-flush --out FILE: the samples so far (safe while
    the program runs: no process access)."""
    if _background is None:
        raise TintError("allocation sampling is not running")
    options = _parse_options(args, [], ["--out"])
    if not options["--out"]:
        raise TintError("--out is required")
    return _background_write(options["--out"])


def _background_stop(debugger, args):
    """tint-heap sample-stop --out FILE: disarms (when the process is
    stopped) and writes every sample."""
    global _background
    if _background is None:
        raise TintError("allocation sampling is not running")
    options = _parse_options(args, [], ["--out"])
    state = _background
    target = debugger.GetSelectedTarget()
    process = target.GetProcess()
    if process.IsValid() and process.GetState() == lldb.eStateStopped:
        descriptor = Descriptor(target, process)
        if descriptor.context != 0:
            arm(descriptor, 0)
            state["flush"](descriptor)
        else:
            _write_u64(process, descriptor.address + 24, 0)
    message = _background_write(options["--out"]) if options["--out"] else "TINTHEAP samples=%d" % state["samples"]
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
_ARGUMENT_REGISTERS = ["x%d" % i for i in range(8)]
_FLOAT_ARGUMENTS = ["d%d" % i for i in range(8)]


def _set_register(frame, name, value):
    register = frame.FindRegister(name)
    if not register.IsValid():
        raise TintError("register %s not found" % name)
    error = lldb.SBError()
    if not register.SetValueFromCString(str(value), error) or not error.Success():
        raise TintError("cannot write %s: %s" % (name, error))


def _collect_begin(descriptor):
    global _collect
    target = descriptor.target
    process = descriptor.process
    thunk = _symbol_address(target, THUNK_SYMBOL)
    if thunk is None:
        raise TintError("%s not found (heap introspection is off)" % THUNK_SYMBOL)
    thread = process.GetSelectedThread()
    frame = thread.GetFrameAtIndex(0)
    if frame.GetPC() != thunk:
        raise TintError("collect-begin needs a stop at %s (tint-heap arm 1)" % THUNK_SYMBOL)
    if descriptor.context == 0:
        raise TintError("no live context")
    sp = frame.FindRegister("sp").GetValueAsUnsigned()
    fp = frame.FindRegister("fp").GetValueAsUnsigned()
    lr = frame.FindRegister("lr").GetValueAsUnsigned()
    saved = {name: frame.FindRegister(name).GetValueAsUnsigned() for name in _ARGUMENT_REGISTERS}
    floats = {name: frame.FindRegister(name).GetValue() for name in _FLOAT_ARGUMENTS}
    # The original request stays pending; disarm so neither call samples.
    arm(descriptor, 0)
    record = sp - 16
    error = lldb.SBError()
    process.WriteMemory(record, struct.pack("<QQ", fp, lr), error)
    if not error.Success():
        raise TintError("cannot push the frame record: %s" % error)
    _set_register(frame, "d0", 0)
    _set_register(frame, "lr", thunk)
    _set_register(frame, "fp", record)
    _set_register(frame, "sp", record)
    _collect = {"thread": thread.GetThreadID(), "sp": sp, "fp": fp, "lr": lr, "saved": saved,
                "floats": floats, "thunk": thunk, "old": descriptor.state["oldTop"],
                "young": descriptor.state["youngTop"]}
    return "TINTHEAP collect-begin sp=0x%x lr=0x%x" % (sp, lr)


def _collect_end(descriptor):
    global _collect
    state = _collect
    if state is None:
        raise TintError("collect-end without collect-begin")
    process = descriptor.process
    thread = process.GetThreadByID(state["thread"])
    frame = thread.GetFrameAtIndex(0)
    sp = frame.FindRegister("sp").GetValueAsUnsigned()
    if frame.GetPC() != state["thunk"] or sp != state["sp"] - 16:
        raise TintError("collect-end: not at the forced collection's return (pc 0x%x sp 0x%x)" % (frame.GetPC(), sp))
    status = frame.FindRegister("x0").GetValueAsUnsigned()
    for name, value in state["saved"].items():
        _set_register(frame, name, value)
    for name, value in state["floats"].items():
        _set_register(frame, name, value)
    _set_register(frame, "lr", state["lr"])
    _set_register(frame, "fp", state["fp"])
    _set_register(frame, "sp", state["sp"])
    _collect = None
    after = Descriptor(descriptor.target, process).state
    return "TINTHEAP collected status=%d old=%d->%d young=%d->%d" % (
        status, state["old"], after["oldTop"], state["young"], after["youngTop"])


# ---------------------------------------------------------------------------
# Data formatters

GENERAL_TAGS = ["undefined", "number", "boolean", "string", "null", "object", "symbol", "bigint"]
STRING_LIMIT = 256
CHILD_LIMIT = 4096


def _process_of(value):
    return value.GetProcess()


def _address_of(value):
    """The object address a value denotes: a pointer's target, or the
    address of a structure value."""
    if value.GetType().IsPointerType():
        return value.GetValueAsUnsigned()
    return value.GetLoadAddress()


def _string_text(process, address, limit=STRING_LIMIT):
    if address == 0:
        return None
    length = _u64(process, address + LENGTH_OFFSET)
    shown = min(length, limit)
    units = (
        struct.unpack("<%dH" % shown, _read(process, address + STRING_UNITS_OFFSET, shown * 2))
        if shown
        else ()
    )
    text = "".join(chr(u) if u < 0xD800 or u > 0xDFFF else "�" for u in units)
    return json.dumps(text, ensure_ascii=False) + ("..." if length > limit else "")


def string_summary(value, internal_dict):
    try:
        address = _address_of(value)
        if address == 0:
            return "null"
        return _string_text(_process_of(value), address)
    except TintError as error:
        return "<%s>" % error


def _marker_type(target, process, address):
    """The SBType of the object at address, from its header and DWARF."""
    marker, flags = split_header(_u64(process, address))
    if marker == 0:
        return None, "uninitialized"
    if marker <= 7:
        name = None
        try:
            kind = Descriptor(target, process).kind_for(marker, flags)
            name = kind["name"] if kind else None
        except TintError:
            pass
        if name is None:
            return None, "kind %d/%d" % (marker, flags)
        sbtype = target.FindFirstType(name)
        return (sbtype if sbtype.IsValid() else None), name
    info = record_types(target).get(marker)
    if info is None:
        return None, "record @0x%x" % marker
    found = target.FindGlobalVariables(
        RECORD_PREFIX + info["module"] + "." + (str(info["index"]) if info["index"] is not None else "function"),
        1,
    )
    if found.GetSize() == 0:
        return None, info["name"]
    return found.GetValueAtIndex(0).GetType(), info["name"]


class ObjectProvider(object):
    """Synthetic children for opaque `object` pointers: the referenced
    object is retyped from its header (record descriptor variable or
    built-in kind structure), so nested fields expand to their real type."""

    def __init__(self, value, internal_dict):
        self.value = value
        self.real = None

    def update(self):
        self.real = None
        try:
            address = _address_of(self.value)
            if address == 0:
                return False
            target = self.value.GetTarget()
            sbtype, _ = _marker_type(target, self.value.GetProcess(), address)
            if sbtype is not None:
                self.real = self.value.CreateValueFromAddress("*", address, sbtype)
        except TintError:
            self.real = None
        return False

    def num_children(self):
        return self.real.GetNumChildren() if self.real is not None else 0

    def get_child_index(self, name):
        return self.real.GetIndexOfChildWithName(name) if self.real is not None else -1

    def get_child_at_index(self, index):
        return self.real.GetChildAtIndex(index) if self.real is not None else None

    def has_children(self):
        return self.real is not None


def object_summary(value, internal_dict):
    try:
        address = _address_of(value)
        if address == 0:
            return "null"
        process = value.GetProcess()
        sbtype, name = _marker_type(value.GetTarget(), process, address)
        if name == "string":
            return _string_text(process, address)
        return name
    except TintError as error:
        return "<%s>" % error


class VectorProvider(object):
    """A reference vector: its slots up to capacity (null slots are holes
    and the vector itself marks a present undefined)."""

    def __init__(self, value, internal_dict, length=None):
        self.value = value
        self.length = length
        self.slots = []

    def update(self):
        self.slots = []
        try:
            address = _address_of(self.value)
            if address == 0:
                return False
            process = self.value.GetProcess()
            capacity = _u64(process, address + LENGTH_OFFSET)
            count = min(capacity if self.length is None else min(self.length, capacity), CHILD_LIMIT)
            raw = _read(process, address + ARRAY_INLINE_OFFSET, count * 8) if count else b""
            words = struct.unpack("<%dQ" % count, raw) if count else ()
            object_type = self.value.GetTarget().FindFirstType("object").GetPointerType()
            for index, word in enumerate(words):
                if word == 0:
                    continue
                name = "[%d]" % index
                if word == address:
                    self.slots.append(self.value.CreateValueFromExpression(name, "(void*)0"))
                else:
                    data = lldb.SBData.CreateDataFromUInt64Array(lldb.eByteOrderLittle, 8, [word])
                    self.slots.append(self.value.CreateValueFromData(name, data, object_type))
        except TintError:
            pass
        return False

    def num_children(self):
        return len(self.slots)

    def get_child_index(self, name):
        try:
            wanted = int(name.lstrip("[").rstrip("]"))
        except ValueError:
            return -1
        for index, child in enumerate(self.slots):
            if child.GetName() == "[%d]" % wanted:
                return index
        return -1

    def get_child_at_index(self, index):
        return self.slots[index] if 0 <= index < len(self.slots) else None

    def has_children(self):
        return True


def _field(value, name):
    """A named member of a record value or record pointer."""
    target = value.Dereference() if value.GetType().IsPointerType() else value
    member = target.GetChildMemberWithName(name)
    return member if member.IsValid() else None


def _number(member):
    if member is None:
        return None
    data = member.GetData()
    error = lldb.SBError()
    if member.GetByteSize() == 8 and "number" in member.GetType().GetName():
        return data.GetDouble(error, 0)
    return member.GetValueAsUnsigned()


class ListProvider(object):
    """A list header {length, root}: dense roots are reference vectors,
    others the sparse tree (shown as its root)."""

    def __init__(self, value, internal_dict):
        self.value = value
        self.inner = None

    def update(self):
        self.inner = None
        try:
            length = _number(_field(self.value, "length"))
            root = _field(self.value, "root")
            if root is None or root.GetValueAsUnsigned() == 0:
                return False
            address = root.GetValueAsUnsigned()
            process = self.value.GetProcess()
            if _u64(process, address) == 6:
                self.inner = VectorProvider(root, None, int(length or 0))
                self.inner.update()
        except TintError:
            self.inner = None
        return False

    def num_children(self):
        return self.inner.num_children() if self.inner else 0

    def get_child_index(self, name):
        return self.inner.get_child_index(name) if self.inner else -1

    def get_child_at_index(self, index):
        return self.inner.get_child_at_index(index) if self.inner else None

    def has_children(self):
        return True


def list_summary(value, internal_dict):
    length = _number(_field(value, "length"))
    return "length=%d" % int(length or 0)


class NumberListProvider(object):
    """A number list {length, values, present}."""

    def __init__(self, value, internal_dict):
        self.value = value
        self.items = []

    def update(self):
        self.items = []
        try:
            length = int(_number(_field(self.value, "length")) or 0)
            values = _field(self.value, "values")
            if values is None or values.GetValueAsUnsigned() == 0:
                return False
            process = self.value.GetProcess()
            base = values.GetValueAsUnsigned()
            count = min(length, _u64(process, base + LENGTH_OFFSET), CHILD_LIMIT)
            present = _field(self.value, "present")
            flags = None
            if present is not None and present.GetValueAsUnsigned() != 0:
                flags = _read(process, present.GetValueAsUnsigned() + ARRAY_INLINE_OFFSET, count)
            raw = _read(process, base + ARRAY_INLINE_OFFSET, count * 8) if count else b""
            double = self.value.GetTarget().FindFirstType("number")
            for index in range(count):
                if flags is not None and flags[index] != 1:
                    continue
                data = lldb.SBData()
                data.SetData(lldb.SBError(), raw[index * 8 : index * 8 + 8], lldb.eByteOrderLittle, 8)
                self.items.append(self.value.CreateValueFromData("[%d]" % index, data, double))
        except TintError:
            pass
        return False

    def num_children(self):
        return len(self.items)

    def get_child_index(self, name):
        for index, child in enumerate(self.items):
            if child.GetName() == name:
                return index
        return -1

    def get_child_at_index(self, index):
        return self.items[index] if 0 <= index < len(self.items) else None

    def has_children(self):
        return True


class EntryChainProvider(object):
    """Insertion-ordered maps and sets ({head, tail, size, ...}): one child
    per entry, following `next`, named by the entry's key."""

    def __init__(self, value, internal_dict):
        self.value = value
        self.items = []

    def _key_text(self, key):
        type_name = key.GetType().GetName()
        if type_name.startswith("string"):
            return string_summary(key, None)
        if type_name == "general":
            return general_summary(key, None)
        if key.GetType().IsPointerType():
            return "0x%x" % key.GetValueAsUnsigned()
        number = _number(key)
        return repr(number)

    def update(self):
        self.items = []
        try:
            entry = _field(self.value, "head")
            seen = 0
            while entry is not None and entry.GetValueAsUnsigned() != 0 and seen < CHILD_LIMIT:
                record = entry.Dereference()
                key = record.GetChildMemberWithName("key")
                value = record.GetChildMemberWithName("value")
                name = "[%s]" % (self._key_text(key) if key.IsValid() else str(seen))
                child = value if value.IsValid() else key
                self.items.append(child.Clone(name) if child.IsValid() else record.Clone(name))
                entry = record.GetChildMemberWithName("next")
                if not entry.IsValid():
                    break
                seen += 1
        except TintError:
            pass
        return False

    def num_children(self):
        return len(self.items)

    def get_child_index(self, name):
        for index, child in enumerate(self.items):
            if child.GetName() == name:
                return index
        return -1

    def get_child_at_index(self, index):
        return self.items[index] if 0 <= index < len(self.items) else None

    def has_children(self):
        return True


def map_summary(value, internal_dict):
    size = _field(value, "size") or _field(value, "count")
    return "size=%d" % int(_number(size) or 0)


def general_summary(value, internal_dict):
    # The raw tag and payload: GeneralProvider's children replace them.
    value = value.GetNonSyntheticValue()
    try:
        tag = value.GetChildMemberWithName("tag").GetValueAsUnsigned()
        payload = value.GetChildMemberWithName("payload")
        raw = payload.GetData().GetUnsignedInt64(lldb.SBError(), 0)
        name = GENERAL_TAGS[tag] if tag < len(GENERAL_TAGS) else "tag %d" % tag
        if tag == 1:
            return repr(struct.unpack("<d", struct.pack("<Q", raw))[0])
        if tag == 2:
            return "true" if raw else "false"
        if tag == 3:
            return _string_text(value.GetProcess(), raw)
        if tag in (0, 4):
            return name
        if tag == 5 and raw:
            _, kind = _marker_type(value.GetTarget(), value.GetProcess(), raw)
            return "%s 0x%x" % (kind, raw)
        return "%s 0x%x" % (name, raw)
    except TintError as error:
        return "<%s>" % error


class GeneralProvider(object):
    """A general value holding an object: the object's fields, retyped
    from its header (other tags have no children)."""

    def __init__(self, value, internal_dict):
        self.value = value
        self.real = None

    def update(self):
        self.real = None
        try:
            raw_value = self.value.GetNonSyntheticValue()
            tag = raw_value.GetChildMemberWithName("tag").GetValueAsUnsigned()
            raw = raw_value.GetChildMemberWithName("payload").GetData().GetUnsignedInt64(lldb.SBError(), 0)
            if tag == 5 and raw:
                sbtype, name = _marker_type(raw_value.GetTarget(), raw_value.GetProcess(), raw)
                if sbtype is not None and name != "string":
                    self.real = raw_value.CreateValueFromAddress("*", raw, sbtype)
        except TintError:
            self.real = None
        return False

    def num_children(self):
        return self.real.GetNumChildren() if self.real is not None else 0

    def get_child_index(self, name):
        return self.real.GetIndexOfChildWithName(name) if self.real is not None else -1

    def get_child_at_index(self, index):
        return self.real.GetChildAtIndex(index) if self.real is not None else None

    def has_children(self):
        return self.real is not None


def _fields_of(sbtype):
    if sbtype.IsPointerType():
        sbtype = sbtype.GetPointeeType()
    # Payload fields only: header members are named "__...".
    names = (sbtype.GetFieldAtIndex(i).GetName() for i in range(sbtype.GetNumberOfFields()))
    return set(name for name in names if not name.startswith("__"))


def is_list_type(sbtype, internal_dict):
    fields = _fields_of(sbtype)
    return fields == {"length", "root"}


def is_number_list_type(sbtype, internal_dict):
    fields = _fields_of(sbtype)
    return fields == {"length", "values", "present"}


def is_entry_chain_type(sbtype, internal_dict):
    fields = _fields_of(sbtype)
    return "head" in fields and "tail" in fields and ("size" in fields or "count" in fields)


def register_formatters(debugger):
    module = __name__
    commands = [
        "type category define -e tint",
        'type summary add -w tint -F %s.string_summary -x "^string( \\*)?$"' % module,
        'type summary add -w tint -F %s.object_summary -x "^object( \\*)?$"' % module,
        'type synthetic add -w tint -l %s.ObjectProvider -x "^object( \\*)?$"' % module,
        'type summary add -w tint -s "capacity=${var.capacity}" vector',
        'type synthetic add -w tint -l %s.VectorProvider -x "^vector( \\*)?$"' % module,
        "type summary add -w tint -F %s.general_summary general" % module,
        "type synthetic add -w tint -l %s.GeneralProvider general" % module,
        "type summary add -w tint -F %s.list_summary --recognizer-function %s.is_list_type" % (module, module),
        "type synthetic add -w tint -l %s.ListProvider --recognizer-function %s.is_list_type" % (module, module),
        "type summary add -w tint -F %s.list_summary --recognizer-function %s.is_number_list_type" % (module, module),
        "type synthetic add -w tint -l %s.NumberListProvider --recognizer-function %s.is_number_list_type"
        % (module, module),
        "type summary add -w tint -F %s.map_summary --recognizer-function %s.is_entry_chain_type" % (module, module),
        "type synthetic add -w tint -l %s.EntryChainProvider --recognizer-function %s.is_entry_chain_type"
        % (module, module),
    ]
    for command in commands:
        result = lldb.SBCommandReturnObject()
        debugger.GetCommandInterpreter().HandleCommand(command, result)
        if not result.Succeeded():
            print("tint: %s: %s" % (command, result.GetError()))


def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand(
        "command script add -o -f %s.heap_command tint-heap" % __name__
    )
    register_formatters(debugger)
