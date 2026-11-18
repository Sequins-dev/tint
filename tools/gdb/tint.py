"""GDB support for Tint native images (docs/native-heap-profiling.md).

    (gdb) source <tint checkout>/tools/gdb/tint.py

adds pretty-printers for Tint strings, reference vectors (lists), records,
Map/Set tables and tagged general values, and the `tint-heap` command
(`tint-heap help`), the same commands as the LLDB adapter
(tools/lldb/tint.py). The heap logic is debugger-neutral
(tools/debugger/tint_heap.py); this file adapts GDB's Python API to it.

Everything is read through the exported `__tint_heap_descriptor` and DWARF,
so the commands work on a live process and on a core file (`gdb <image>
<core>`; `gcore <file>`). Start a process at its first instruction with
`starti` where LLDB uses `process launch --stop-at-entry`.
"""

import os
import re
import struct
import sys

import gdb

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "debugger"))
import tint_heap as core  # noqa: E402

TintError = core.TintError

# GDB names the AArch64 frame pointer and link register by number.
_REGISTER_NAMES = {"fp": "x29", "lr": "x30"}

# The latest stop and exit, from GDB's events.
_events = {"breakpoints": [], "exit": None}


def _on_stop(event):
    _events["breakpoints"] = [b.number for b in getattr(event, "breakpoints", [])]


def _on_exit(event):
    _events["exit"] = getattr(event, "exit_code", None)


def _on_continue(event):
    _events["breakpoints"] = []


# ---------------------------------------------------------------------------
# Types


def _type_name(gdbtype):
    """LLDB-style type names: `object *`, `{x, y, label}`, `number`."""
    if gdbtype.code == gdb.TYPE_CODE_PTR:
        return _type_name(gdbtype.target()) + " *"
    if gdbtype.code in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION, gdb.TYPE_CODE_ENUM):
        return gdbtype.tag or gdbtype.name or str(gdbtype)
    return gdbtype.name or str(gdbtype)


_CLASSES = {
    gdb.TYPE_CODE_PTR: "pointer",
    gdb.TYPE_CODE_STRUCT: "struct",
    gdb.TYPE_CODE_UNION: "union",
    gdb.TYPE_CODE_ARRAY: "array",
    gdb.TYPE_CODE_ENUM: "enum",
}


def _describe_struct(gdbtype):
    gdbtype = gdbtype.strip_typedefs()
    fields = []
    for field in gdbtype.fields():
        ftype = field.type
        entry = {
            "name": field.name,
            "offset": field.bitpos // 8,
            "type": _type_name(ftype),
            "class": _CLASSES.get(ftype.strip_typedefs().code, "base"),
            "size": ftype.sizeof,
        }
        if entry["class"] == "pointer":
            entry["target"] = _type_name(ftype.strip_typedefs().target())
        fields.append(entry)
    return {"name": _type_name(gdbtype), "size": gdbtype.sizeof, "fields": fields}


def _struct_type(name):
    """A DWARF structure by tag (`string`, `vector`, ...)."""
    for spelling in ("struct " + name, name):
        try:
            found = gdb.lookup_type(spelling)
        except gdb.error:
            continue
        if found.strip_typedefs().code == gdb.TYPE_CODE_STRUCT:
            return found
    return None


def _variable(name):
    return gdb.lookup_global_symbol(name) or gdb.lookup_static_symbol(name)


# ---------------------------------------------------------------------------
# The inferior interface (see tint_heap's docstring)


def _register(frame, name):
    name = _REGISTER_NAMES.get(name, name)
    try:
        if name.startswith("d") and name[1:].isdigit():
            return int(frame.read_register(name)["u"]) & 0xFFFFFFFFFFFFFFFF
        return int(frame.read_register(name)) & 0xFFFFFFFFFFFFFFFF
    except (gdb.error, ValueError) as error:
        raise TintError("register %s: %s" % (name, error))


class GdbFrame(object):
    def __init__(self, frame, cfa):
        self.frame = frame
        self.pc = frame.pc()
        self.cfa = cfa
        self.inlined = frame.type() == gdb.INLINE_FRAME
        self.function = frame.name() or ""
        sal = frame.find_sal()
        self.file = sal.symtab.fullname() if sal.symtab is not None else None
        self.line = sal.line if sal.symtab is not None else 0
        self.fp = self._safe("fp")
        self.sp = self._safe("sp")

    def _safe(self, name):
        try:
            return _register(self.frame, name)
        except TintError:
            return 0

    def register(self, name):
        return _register(self.frame, name)


class GdbThread(object):
    def __init__(self, thread):
        self.thread = thread
        self.id = thread.ptid[1] or thread.ptid[0]
        self.index = thread.num
        self._frames = None

    def _select(self):
        if gdb.selected_thread() != self.thread:
            self.thread.switch()

    def frames(self):
        """Innermost first; inlined frames share their physical frame's
        `cfa` key (GDB has no CFA accessor: the key is the physical frame's
        position)."""
        if self._frames is None:
            self._select()
            frames = []
            physical = 0
            frame = gdb.newest_frame()
            while frame is not None and len(frames) < 100000:
                entry = GdbFrame(frame, physical)
                frames.append(entry)
                if not entry.inlined:
                    physical += 1
                try:
                    frame = frame.older()
                except gdb.error:
                    break
            self._frames = frames
        return self._frames

    def register(self, name):
        self._select()
        return _register(gdb.newest_frame(), name)

    def write_register(self, name, value):
        self._select()
        self._frames = None
        gdb.newest_frame().select()
        name = _REGISTER_NAMES.get(name, name)
        target = "$%s.u" % name if name.startswith("d") and name[1:].isdigit() else "$" + name
        try:
            gdb.execute("set var %s = %d" % (target, value), to_string=True)
        except gdb.error as error:
            raise TintError("cannot write %s: %s" % (name, error))

    def save_registers(self, names):
        # Raw bits, floating-point registers included.
        return {name: self.register(name) for name in names}

    def restore_registers(self, saved):
        for name, value in saved.items():
            self.write_register(name, value)

    def stop_breakpoint(self):
        found = _events["breakpoints"]
        return found[0] if found else None

    def stop_description(self):
        try:
            return gdb.execute("info program", to_string=True).strip()
        except gdb.error as error:
            return str(error)


class GdbInferior(object):
    def __init__(self, inferior):
        self.inferior = inferior
        self.breakpoints = {}

    def read(self, address, length):
        try:
            return self.inferior.read_memory(address, length).tobytes()
        except (gdb.MemoryError, gdb.error) as error:
            raise TintError("cannot read %d bytes at 0x%x: %s" % (length, address, error))

    def write(self, address, data):
        try:
            self.inferior.write_memory(address, data)
        except (gdb.MemoryError, gdb.error) as error:
            raise TintError("cannot write %d bytes at 0x%x: %s" % (len(data), address, error))

    def symbol_address(self, name):
        try:
            return int(gdb.parse_and_eval("(unsigned long)&'%s'" % name))
        except gdb.error:
            return None

    def image_info(self):
        """The executable's slide from the auxiliary vector's AT_ENTRY (live
        processes and cores alike) and the ELF header's entry point."""
        path = gdb.current_progspace().filename
        with open(path, "rb") as handle:
            header = handle.read(64)
            entry, phoff = struct.unpack_from("<QQ", header, 24)
            phentsize, phnum = struct.unpack_from("<HH", header, 54)
            handle.seek(phoff)
            headers = handle.read(phentsize * phnum)
        file_address = 0
        for index in range(phnum):
            kind, _, offset, vaddr = struct.unpack_from("<IIQQ", headers, index * phentsize)
            if kind == 1 and offset == 0:  # PT_LOAD holding the ELF header
                file_address = vaddr
                break
        slide = 0
        try:
            auxv = gdb.execute("info auxv", to_string=True)
            match = re.search(r"AT_ENTRY\s.*\s(0x[0-9a-f]+)\s*$", auxv, re.M)
            if match:
                slide = int(match.group(1), 16) - entry
        except gdb.error:
            pass
        objfile = gdb.lookup_objfile(path) if hasattr(gdb, "lookup_objfile") else None
        return {
            "path": path,
            "loadAddress": file_address + slide,
            "fileAddress": file_address,
            "slide": slide,
            "uuid": (objfile.build_id if objfile is not None else None) or "",
        }

    def cache_key(self):
        return (gdb.current_progspace().filename, self.inferior.pid)

    def record_variables(self):
        listing = gdb.execute("info variables ^%s" % re.escape(core.RECORD_PREFIX), to_string=True)
        out = []
        seen = set()
        for match in re.finditer(r"(%s\S+);\s*$" % re.escape(core.RECORD_PREFIX), listing, re.M):
            name = match.group(1)
            symbol = _variable(name)
            if name in seen or symbol is None:
                continue
            seen.add(name)
            # The DWARF location is known without reading memory: cores
            # need not contain the image's pages.
            address = int(symbol.value().address)
            out.append({"name": name, "address": address, "type": _describe_struct(symbol.type)})
        return out

    def describe_type(self, name):
        found = _struct_type(name)
        return _describe_struct(found) if found is not None else None

    def has_process(self):
        return self.inferior.pid != 0

    def is_core(self):
        connection = getattr(self.inferior, "connection", None)
        if connection is not None:
            return connection.type == "core"
        return "core dump" in gdb.execute("info target", to_string=True)

    def is_stopped(self):
        if self.inferior.pid == 0:
            return False
        thread = gdb.selected_thread()
        return thread is not None and thread.is_valid() and thread.is_stopped()

    def exit_status(self):
        code = _events["exit"]
        if code is None:
            value = gdb.convenience_variable("_exitcode")
            code = int(value) if value is not None else -1
        return code

    def selected_thread(self):
        thread = gdb.selected_thread()
        if thread is None:
            raise TintError("no thread selected")
        return GdbThread(thread)

    def thread_by_id(self, thread_id):
        for thread in self.inferior.threads():
            if (thread.ptid[1] or thread.ptid[0]) == thread_id:
                return GdbThread(thread)
        raise TintError("no thread %d" % thread_id)

    def resume(self):
        _events["breakpoints"] = []
        try:
            gdb.execute("continue", to_string=True)
        except gdb.error as error:
            raise TintError("continue: %s" % error)

    def _add(self, breakpoint):
        # The tools' own stops print nothing (samples stop hundreds of times).
        breakpoint.silent = True
        self.breakpoints[breakpoint.number] = breakpoint
        return breakpoint.number

    def break_at_address(self, name):
        if self.symbol_address(name) is None:
            raise TintError("%s not found" % name)
        # An address expression is re-evaluated when the image is relocated.
        return self._add(gdb.Breakpoint("*'%s'" % name, internal=True))

    def break_at_function(self, qualified):
        pattern = re.escape(qualified).replace("\\:", ":") + "\\( \\|$\\)"
        listing = gdb.execute("info functions %s" % pattern, to_string=True)
        names = re.findall(r"(\S*%s(?: \[[^\]]*\])?)\(" % re.escape(qualified), listing)
        return [self._add(gdb.Breakpoint(function=name, internal=True)) for name in dict.fromkeys(names)]

    def delete_breakpoint(self, breakpoint):
        found = self.breakpoints.pop(breakpoint, None)
        if found is not None and found.is_valid():
            found.delete()

    def disable_breakpoint(self, breakpoint):
        found = self.breakpoints.get(breakpoint)
        if found is not None and found.is_valid():
            found.enabled = False

    def watch_writes(self, address, size):
        kind = {1: "char", 2: "short", 4: "int", 8: "long"}.get(size)
        if kind is None:
            raise TintError("cannot watch %d bytes" % size)
        try:
            return self._add(
                gdb.Breakpoint("*(unsigned %s *)%d" % (kind, address), gdb.BP_WATCHPOINT, gdb.WP_WRITE, internal=True)
            )
        except gdb.error as error:
            raise TintError("cannot watch 0x%x: %s" % (address, error))

    def delete_watchpoint(self, watch):
        self.delete_breakpoint(watch)


# One inferior adapter per GDB inferior, so breakpoints created by one
# command (sample, snapshot-points) stay addressable by the next.
_inferiors = {}


def _inferior():
    inferior = gdb.selected_inferior()
    if inferior.pid == 0:
        return None
    adapter = _inferiors.get(inferior.num)
    if adapter is None or adapter.inferior != inferior:
        adapter = GdbInferior(inferior)
        _inferiors[inferior.num] = adapter
    return adapter


class TintHeapCommand(gdb.Command):
    """Tint heap tools: `tint-heap help`."""

    def __init__(self):
        super(TintHeapCommand, self).__init__("tint-heap", gdb.COMMAND_DATA)

    def invoke(self, argument, from_tty):
        self.dont_repeat()
        try:
            print(core.command(_inferior(), gdb.string_to_argv(argument)))
        except TintError as error:
            raise gdb.GdbError(str(error))


# ---------------------------------------------------------------------------
# Pretty-printers


def _value_inferior():
    return GdbInferior(gdb.selected_inferior())


def _fields(gdbtype):
    gdbtype = gdbtype.strip_typedefs()
    if gdbtype.code != gdb.TYPE_CODE_STRUCT:
        return set()
    return core.payload_fields(field.name for field in gdbtype.fields())


def _has_field(value, name):
    return any(field.name == name for field in value.type.strip_typedefs().fields())


def _number(value):
    if value.type.strip_typedefs().code == gdb.TYPE_CODE_FLT:
        return float(value)
    return int(value)


def _object_pointer_type():
    found = _struct_type("object")
    return found.pointer() if found is not None else gdb.lookup_type("void").pointer()


def _retyped(address):
    """A pointer to the object at address typed from its header, and the
    header's label."""
    type_name, label, variable = core.object_kind(_value_inferior(), address)
    gdbtype = None
    if type_name is not None:
        gdbtype = _struct_type(type_name)
    elif variable is not None:
        symbol = _variable(variable)
        gdbtype = symbol.type if symbol is not None else None
    if gdbtype is None:
        return None, label
    return gdb.Value(address).cast(gdbtype.pointer()), label


def _struct_children(pointer):
    real = pointer.dereference()
    for field in real.type.strip_typedefs().fields():
        yield field.name, real[field.name]


class StringPrinter(object):
    def __init__(self, value):
        self.value = value

    def to_string(self):
        address = int(self.value)
        if address == 0:
            return "null"
        try:
            return "0x%x %s" % (address, core.string_text(_value_inferior(), address))
        except TintError as error:
            return "0x%x <%s>" % (address, error)


class ObjectPrinter(object):
    """Opaque `object` pointers: the referenced object is retyped from its
    header (record descriptor variable or built-in kind structure), so
    nested fields print with their real type."""

    def __init__(self, value):
        self.value = value
        self.address = int(value)
        self.real = None
        self.label = None
        self.inner = None
        if self.address == 0:
            return
        try:
            self.real, self.label = _retyped(self.address)
        except TintError as error:
            self.label = "<%s>" % error
        if self.real is not None:
            self.inner = _lookup(self.real)

    def to_string(self):
        if self.address == 0:
            return "null"
        if isinstance(self.inner, StringPrinter):
            return self.inner.to_string()
        return "0x%x %s" % (self.address, self.label)

    def children(self):
        if self.real is None or isinstance(self.inner, StringPrinter):
            return iter(())
        if self.inner is not None and hasattr(self.inner, "children"):
            return self.inner.children()
        return _struct_children(self.real)


class VectorPrinter(object):
    """A reference vector: its slots up to capacity (null slots are holes
    and the vector itself marks a present undefined)."""

    def __init__(self, value, length=None):
        self.value = value
        self.length = length

    def to_string(self):
        address = int(self.value)
        if address == 0:
            return "null"
        try:
            return "0x%x capacity=%d" % (address, core.read_u64(_value_inferior(), address + core.LENGTH_OFFSET))
        except TintError as error:
            return "0x%x <%s>" % (address, error)

    def children(self):
        address = int(self.value)
        if address == 0:
            return
        try:
            slots = core.vector_slots(_value_inferior(), address, self.length)
        except TintError:
            return
        object_type = _object_pointer_type()
        void = gdb.lookup_type("void").pointer()
        for index, word in slots:
            yield "[%d]" % index, gdb.Value(0).cast(void) if word == 0 else gdb.Value(word).cast(object_type)


class ListPrinter(object):
    """A list header {length, root}: dense roots are reference vectors,
    others the sparse tree (shown as its root)."""

    def __init__(self, value):
        self.value = value

    def to_string(self):
        return "length=%d" % int(_number(self.value["length"]))

    def children(self):
        root = int(self.value["root"])
        if root == 0:
            return iter(())
        try:
            if not core.is_dense_root(_value_inferior(), root):
                return iter(())
        except TintError:
            return iter(())
        return VectorPrinter(gdb.Value(root), int(_number(self.value["length"]))).children()


class NumberListPrinter(object):
    """A number list {length, values, present}."""

    def __init__(self, value):
        self.value = value

    def to_string(self):
        return "length=%d" % int(_number(self.value["length"]))

    def children(self):
        values = int(self.value["values"])
        if values == 0:
            return
        try:
            items = core.number_list_values(
                _value_inferior(), values, int(self.value["present"]), int(_number(self.value["length"]))
            )
        except TintError:
            return
        for index, number in items:
            yield "[%d]" % index, gdb.Value(number)


def _key_text(key):
    name = _type_name(key.type)
    if name.startswith("string"):
        address = int(key)
        return "null" if address == 0 else core.string_text(_value_inferior(), address)
    if name == "general":
        return GeneralPrinter(key).to_string()
    if key.type.strip_typedefs().code == gdb.TYPE_CODE_PTR:
        return "0x%x" % int(key)
    return repr(_number(key))


def _entry_record(pointer):
    """The entry a chain pointer refers to: typed pointers dereference,
    opaque `object` pointers are retyped from the entry's header."""
    target = pointer.type.strip_typedefs().target().strip_typedefs()
    if target.tag != "object":
        return pointer.dereference()
    real, _ = _retyped(int(pointer))
    return real.dereference() if real is not None else None


class EntryChainPrinter(object):
    """Insertion-ordered maps and sets ({head, tail, size, ...}): one child
    per entry, following `next`, named by the entry's key."""

    def __init__(self, value):
        self.value = value

    def to_string(self):
        name = "size" if _has_field(self.value, "size") else "count"
        return "size=%d" % int(_number(self.value[name]))

    def children(self):
        entry = self.value["head"]
        seen = 0
        while int(entry) != 0 and seen < core.CHILD_LIMIT:
            record = _entry_record(entry)
            if record is None:
                break
            has_key = _has_field(record, "key")
            try:
                label = _key_text(record["key"]) if has_key else str(seen)
            except TintError as error:
                label = "<%s>" % error
            child = record["value"] if _has_field(record, "value") else (record["key"] if has_key else record)
            yield "[%s]" % label, child
            if not _has_field(record, "next"):
                break
            entry = record["next"]
            seen += 1


def _general_parts(value):
    tag = int(value["tag"])
    payload = value["payload"]
    for field in payload.type.strip_typedefs().fields():
        ftype = field.type.strip_typedefs()
        if ftype.sizeof == 8 and ftype.code in (gdb.TYPE_CODE_PTR, gdb.TYPE_CODE_INT):
            return tag, int(payload[field.name]) & 0xFFFFFFFFFFFFFFFF
    return tag, struct.unpack("<Q", struct.pack("<d", float(payload["number"])))[0]


class GeneralPrinter(object):
    """A tagged general value; one holding an object shows the object's
    fields, retyped from its header."""

    def __init__(self, value):
        self.value = value

    def to_string(self):
        try:
            tag, raw = _general_parts(self.value)
            return core.general_text(_value_inferior(), tag, raw)
        except TintError as error:
            return "<%s>" % error

    def children(self):
        try:
            tag, raw = _general_parts(self.value)
            if tag != 5 or raw == 0:
                return iter(())
            real, label = _retyped(raw)
        except TintError:
            return iter(())
        if real is None or label == "string":
            return iter(())
        return _struct_children(real)


class PointerPrinter(object):
    """A typed pointer to a recognized structure: its address, then the
    structure's printer."""

    def __init__(self, value, inner):
        self.value = value
        self.inner = inner

    def to_string(self):
        return "0x%x %s" % (int(self.value), self.inner.to_string())

    def children(self):
        return self.inner.children()


def _struct_printer(value):
    gdbtype = value.type.strip_typedefs()
    if gdbtype.tag == "general":
        return GeneralPrinter(value)
    fields = _fields(gdbtype)
    if core.is_list_fields(fields):
        return ListPrinter(value)
    if core.is_number_list_fields(fields):
        return NumberListPrinter(value)
    if core.is_entry_chain_fields(fields):
        return EntryChainPrinter(value)
    return None


def _lookup(value):
    gdbtype = value.type.strip_typedefs()
    if gdbtype.code == gdb.TYPE_CODE_PTR:
        target = gdbtype.target().strip_typedefs()
        if target.code != gdb.TYPE_CODE_STRUCT:
            return None
        if target.tag == "string":
            return StringPrinter(value)
        if target.tag == "object":
            return ObjectPrinter(value)
        if target.tag == "vector":
            return VectorPrinter(value)
        if int(value) == 0 or target.tag == "general":
            return None
        inner = _struct_printer(value.dereference())
        return PointerPrinter(value, inner) if inner is not None else None
    if gdbtype.code == gdb.TYPE_CODE_STRUCT:
        return _struct_printer(value)
    return None


def tint_printer(value):
    """GDB pretty-printer lookup for Tint values."""
    try:
        return _lookup(value)
    except (gdb.error, TintError):
        return None


tint_printer.name = "tint"
tint_printer.enabled = True


def register():
    TintHeapCommand()
    gdb.pretty_printers[:] = [p for p in gdb.pretty_printers if getattr(p, "name", None) != "tint"]
    gdb.pretty_printers.append(tint_printer)
    for registry, handler in (
        (gdb.events.stop, _on_stop),
        (gdb.events.exited, _on_exit),
        (gdb.events.cont, _on_continue),
    ):
        registry.connect(handler)


register()
