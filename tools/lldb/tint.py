"""LLDB support for Tint native images (docs/native-heap-profiling.md).

    (lldb) command script import <tint checkout>/tools/lldb/tint.py

adds data formatters for Tint strings, reference vectors (lists), records,
Map/Set tables and tagged general values, and the `tint-heap` command
(`tint-heap help`). The heap logic is debugger-neutral
(tools/debugger/tint_heap.py, shared with the GDB adapter tools/gdb/tint.py);
this module adapts LLDB's SB API to it and provides LLDB's formatters.

Everything is read through the exported `__tint_heap_descriptor` (layout:
packages/abi/src/heap-debug.ts) and DWARF, so the commands work on a live
process and on a core file (`lldb <image> -c <core>`; `process save-core`).
"""

import os
import shlex
import struct
import sys

import lldb

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "debugger"))
import tint_heap as core  # noqa: E402

TintError = core.TintError


# ---------------------------------------------------------------------------
# The inferior interface (see tint_heap's docstring)


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


class LldbFrame(object):
    def __init__(self, frame):
        self.frame = frame
        line = frame.GetLineEntry()
        self.pc = frame.GetPC()
        self.fp = frame.GetFP()
        self.sp = frame.GetSP()
        self.cfa = frame.GetCFA()
        self.function = frame.GetDisplayFunctionName() or frame.GetFunctionName() or ""
        self.file = line.GetFileSpec().fullpath if line.IsValid() else None
        self.line = line.GetLine() if line.IsValid() else 0
        self.inlined = frame.IsInlined()

    def register(self, name):
        value = self.frame.FindRegister(name)
        if not value.IsValid():
            raise TintError("register %s not found" % name)
        return value.GetValueAsUnsigned()


class LldbThread(object):
    def __init__(self, thread):
        self.thread = thread
        self.id = thread.GetThreadID()
        self.index = thread.GetIndexID()
        self._frames = None

    def frames(self):
        if self._frames is None:
            self._frames = [LldbFrame(self.thread.GetFrameAtIndex(i)) for i in range(self.thread.GetNumFrames())]
        return self._frames

    def _top(self):
        return self.thread.GetFrameAtIndex(0)

    def register(self, name):
        return LldbFrame(self._top()).register(name)

    def write_register(self, name, value):
        self._frames = None
        register = self._top().FindRegister(name)
        if not register.IsValid():
            raise TintError("register %s not found" % name)
        error = lldb.SBError()
        if not register.SetValueFromCString(str(value), error) or not error.Success():
            raise TintError("cannot write %s: %s" % (name, error))

    def save_registers(self, names):
        # Floating-point registers round-trip through their text form.
        frame = self._top()
        return {
            name: (frame.FindRegister(name).GetValue() if name.startswith("d") else frame.FindRegister(name).GetValueAsUnsigned())
            for name in names
        }

    def restore_registers(self, saved):
        for name, value in saved.items():
            self.write_register(name, value)

    def stop_breakpoint(self):
        if self.thread.GetStopReason() != lldb.eStopReasonBreakpoint:
            return None
        return self.thread.GetStopReasonDataAtIndex(0)

    def stop_description(self):
        return self.thread.GetStopDescription(200)


class LldbInferior(object):
    def __init__(self, target, process, debugger=None):
        self.target = target
        self.process = process
        self.debugger = debugger

    def read(self, address, length):
        error = lldb.SBError()
        data = self.process.ReadMemory(address, length, error)
        if not error.Success() or data is None or len(data) != length:
            raise TintError("cannot read %d bytes at 0x%x: %s" % (length, address, error))
        return data

    def write(self, address, data):
        error = lldb.SBError()
        written = self.process.WriteMemory(address, data, error)
        if not error.Success() or written != len(data):
            raise TintError("cannot write %d bytes at 0x%x: %s" % (len(data), address, error))

    def symbol_address(self, name):
        for kind in (lldb.eSymbolTypeData, lldb.eSymbolTypeCode, lldb.eSymbolTypeAny):
            found = self.target.FindSymbols(name, kind)
            for index in range(found.GetSize()):
                symbol = found.GetContextAtIndex(index).GetSymbol()
                if symbol.IsValid():
                    address = symbol.GetStartAddress().GetLoadAddress(self.target)
                    if address != lldb.LLDB_INVALID_ADDRESS:
                        return address
        return None

    def image_info(self):
        module = self.target.GetModuleAtIndex(0)
        header = module.GetObjectFileHeaderAddress()
        load = header.GetLoadAddress(self.target)
        file_address = header.GetFileAddress()
        return {
            "path": module.GetFileSpec().fullpath,
            "loadAddress": load,
            "fileAddress": file_address,
            "slide": load - file_address,
            "uuid": module.GetUUIDString(),
        }

    def cache_key(self):
        process = self.process
        return (self.target.GetExecutable().fullpath, process.GetProcessID() if process.IsValid() else 0)

    def record_variables(self):
        found = self.target.FindGlobalVariables(
            "^" + core.RECORD_PREFIX.replace(".", "\\."), 1 << 20, lldb.eMatchTypeRegex
        )
        out = []
        for index in range(found.GetSize()):
            # Formatters would read the (absent) memory and drop the location.
            value = found.GetValueAtIndex(index).GetNonSyntheticValue()
            # The DWARF location (DW_OP_addr) is known without reading memory:
            # cores need not contain the image's pages.
            location = value.GetLocation() or ""
            try:
                address = int(location, 16)
            except ValueError:
                sbaddress = value.GetAddress()
                address = sbaddress.GetLoadAddress(self.target)
                if address == lldb.LLDB_INVALID_ADDRESS:
                    address = sbaddress.GetFileAddress()
            out.append({"name": value.GetName(), "address": address, "type": _describe_struct(value.GetType())})
        return out

    def describe_type(self, name):
        sbtype = self.target.FindFirstType(name)
        return _describe_struct(sbtype) if sbtype.IsValid() else None

    def has_process(self):
        return self.process.IsValid()

    def is_core(self):
        # Core files load through a core process plugin (mach-o-core,
        # elf-core, minidump); live processes through gdb-remote.
        name = self.process.GetPluginName() or ""
        return "core" in name or "minidump" in name

    def is_stopped(self):
        return self.process.GetState() == lldb.eStateStopped

    def exit_status(self):
        return self.process.GetExitStatus()

    def selected_thread(self):
        return LldbThread(self.process.GetSelectedThread())

    def thread_by_id(self, thread_id):
        return LldbThread(self.process.GetThreadByID(thread_id))

    def resume(self):
        if self.debugger is not None:
            self.debugger.SetAsync(False)
        self.process.Continue()

    def break_at_address(self, name):
        breakpoint = self.target.BreakpointCreateByName(name)
        if breakpoint.GetNumLocations() == 0:
            raise TintError("%s not found" % name)
        return breakpoint.GetID()

    def break_at_function(self, qualified):
        pattern = qualified.replace(".", "\\.") + "( |$)"
        breakpoint = self.target.BreakpointCreateByRegex(pattern)
        return [breakpoint.GetID()] if breakpoint.GetNumLocations() > 0 else []

    def delete_breakpoint(self, breakpoint):
        self.target.BreakpointDelete(breakpoint)

    def disable_breakpoint(self, breakpoint):
        self.target.FindBreakpointByID(breakpoint).SetEnabled(False)

    def watch_writes(self, address, size):
        error = lldb.SBError()
        watch = self.target.WatchAddress(address, size, False, True, error)
        if not error.Success():
            raise TintError("cannot watch 0x%x: %s" % (address, error))
        return watch.GetID()

    def delete_watchpoint(self, watch):
        self.target.DeleteWatchpoint(watch)


def _inferior_of(debugger):
    target = debugger.GetSelectedTarget()
    process = target.GetProcess()
    if not target.IsValid() or not process.IsValid():
        return None
    return LldbInferior(target, process, debugger)


def _value_inferior(value):
    return LldbInferior(value.GetTarget(), value.GetProcess())


def heap_command(debugger, command, result, internal_dict):
    try:
        result.AppendMessage(core.command(_inferior_of(debugger), shlex.split(command)))
    except TintError as error:
        result.SetError(str(error))


# ---------------------------------------------------------------------------
# Data formatters


def _address_of(value):
    """The object address a value denotes: a pointer's target, or the
    address of a structure value."""
    if value.GetType().IsPointerType():
        return value.GetValueAsUnsigned()
    return value.GetLoadAddress()


def string_summary(value, internal_dict):
    try:
        address = _address_of(value)
        if address == 0:
            return "null"
        return core.string_text(_value_inferior(value), address)
    except TintError as error:
        return "<%s>" % error


def _marker_type(value, address):
    """The SBType and label of the object at address, from its header and
    DWARF."""
    target = value.GetTarget()
    type_name, label, variable = core.object_kind(_value_inferior(value), address)
    if type_name is not None:
        sbtype = target.FindFirstType(type_name)
        return (sbtype if sbtype.IsValid() else None), label
    if variable is None:
        return None, label
    found = target.FindGlobalVariables(variable, 1)
    if found.GetSize() == 0:
        return None, label
    return found.GetValueAtIndex(0).GetType(), label


class ObjectProvider(object):
    """Synthetic children for opaque `object` pointers: the referenced
    object is retyped from its header (record descriptor variable or
    built-in kind structure), so nested fields expand to their real type."""

    def __init__(self, value, internal_dict):
        self.value = value
        self.real = None
        self.updated = False

    def update(self):
        self.real = None
        self.updated = True
        try:
            address = _address_of(self.value)
            if address == 0:
                return False
            sbtype, _ = _marker_type(self.value, address)
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
        # LLDB may ask before update() (LLVM 19's lldb-dap does, through
        # SBValue.MightHaveChildren, and hides the children on False).
        if not self.updated:
            self.update()
        return self.real is not None


def object_summary(value, internal_dict):
    try:
        address = _address_of(value)
        if address == 0:
            return "null"
        _, name = _marker_type(value, address)
        if name == "string":
            return core.string_text(_value_inferior(value), address)
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
            object_type = self.value.GetTarget().FindFirstType("object").GetPointerType()
            for index, word in core.vector_slots(_value_inferior(self.value), address, self.length):
                name = "[%d]" % index
                if word == 0:
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
    raw = value.GetNonSyntheticValue()
    target = raw.Dereference().GetNonSyntheticValue() if raw.GetType().IsPointerType() else raw
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
            if core.is_dense_root(_value_inferior(self.value), root.GetValueAsUnsigned()):
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
            present = _field(self.value, "present")
            present = present.GetValueAsUnsigned() if present is not None else 0
            double = self.value.GetTarget().FindFirstType("number")
            for index, number in core.number_list_values(
                _value_inferior(self.value), values.GetValueAsUnsigned(), present, length
            ):
                # SBData.SetData with a bytes buffer is unreliable across
                # LLDB builds (LLVM 19's SWIG binding copies the object
                # pointer); the word array form is portable.
                (word,) = struct.unpack("<Q", struct.pack("<d", number))
                data = lldb.SBData.CreateDataFromUInt64Array(lldb.eByteOrderLittle, 8, [word])
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
            while entry is not None and entry.GetValueAsUnsigned() != 0 and seen < core.CHILD_LIMIT:
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


class DenseMapProvider(object):
    """Open-addressed insertion-ordered StringKeyMap / NumberKeyMap: one child
    per live entry, named by its key."""

    def __init__(self, value, internal_dict):
        self.value = value
        self.items = []

    def update(self):
        self.items = []
        try:
            length = int(_number(_field(self.value, "length")) or 0)
            keys = _field(self.value, "keys")
            values = _field(self.value, "values")
            hashes = _field(self.value, "hashes")
            deleted = _field(self.value, "deleted")
            if keys is None or values is None:
                return False
            keys_addr = keys.GetNonSyntheticValue().GetValueAsUnsigned()
            values_addr = values.GetNonSyntheticValue().GetValueAsUnsigned()
            if keys_addr == 0 or values_addr == 0 or length <= 0:
                return False
            inferior = _value_inferior(self.value)
            hashes_addr = hashes.GetNonSyntheticValue().GetValueAsUnsigned() if hashes is not None else 0
            deleted_addr = deleted.GetNonSyntheticValue().GetValueAsUnsigned() if deleted is not None else 0
            live = core.dense_map_live_indices(inferior, hashes_addr, deleted_addr, length)
            if not live:
                return False
            # Optional fields (`keys`, `values`) have DWARF type `object *`;
            # retype them from their heap header so list/number-list fields are visible.
            val_real = values.GetNonSyntheticValue()
            if val_real.GetType().GetName().startswith("object"):
                sbtype, _ = _marker_type(self.value, values_addr)
                if sbtype is not None:
                    val_real = self.value.CreateValueFromAddress("*", values_addr, sbtype).GetNonSyntheticValue()
            val_fields = _fields_of(val_real.GetType())
            val_children = {}
            if core.is_number_list_fields(val_fields):
                vp = NumberListProvider(val_real, None)
                vp.update()
                for child in vp.items:
                    val_children[child.GetName()] = child
            elif core.is_list_fields(val_fields):
                vp = ListProvider(val_real, None)
                vp.update()
                if vp.inner is not None:
                    for child in vp.inner.slots:
                        val_children[child.GetName()] = child
            if hashes is not None:
                # StringKeyMap: keys is string[] ({length, root}).
                keys_real = keys.GetNonSyntheticValue()
                if keys_real.GetType().GetName().startswith("object"):
                    sbtype, _ = _marker_type(self.value, keys_addr)
                    if sbtype is not None:
                        keys_real = self.value.CreateValueFromAddress("*", keys_addr, sbtype).GetNonSyntheticValue()
                key_root = _field(keys_real, "root")
                key_words = {}
                if key_root is not None and key_root.GetNonSyntheticValue().GetValueAsUnsigned() != 0:
                    root_addr = key_root.GetNonSyntheticValue().GetValueAsUnsigned()
                    if core.is_dense_root(inferior, root_addr):
                        for idx, word in core.vector_slots(inferior, root_addr, length):
                            key_words[idx] = word
                for idx in live:
                    word = key_words.get(idx, 0)
                    label = (core.string_text(inferior, word) if word else None) or str(idx)
                    child = val_children.get("[%d]" % idx)
                    if child is not None:
                        self.items.append(child.Clone("[%s]" % label))
            else:
                # NumberKeyMap: keys is Float64Array.
                nums = core.float64_array_values(inferior, keys_addr, length)
                for idx in live:
                    label = repr(nums[idx]) if idx < len(nums) else str(idx)
                    child = val_children.get("[%d]" % idx)
                    if child is not None:
                        self.items.append(child.Clone("[%s]" % label))
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


class DenseSetProvider(object):
    """Open-addressed insertion-ordered CompactSet: one child per live member
    in insertion order."""

    def __init__(self, value, internal_dict):
        self.value = value
        self.items = []

    def update(self):
        self.items = []
        try:
            length = int(_number(_field(self.value, "length")) or 0)
            members = _field(self.value, "members")
            hashes = _field(self.value, "hashes")
            if members is None or hashes is None:
                return False
            members_addr = members.GetNonSyntheticValue().GetValueAsUnsigned()
            hashes_addr = hashes.GetNonSyntheticValue().GetValueAsUnsigned()
            if members_addr == 0 or hashes_addr == 0 or length <= 0:
                return False
            inferior = _value_inferior(self.value)
            live = core.dense_map_live_indices(inferior, hashes_addr, 0, length)
            if not live:
                return False
            mem_real = members.GetNonSyntheticValue()
            if mem_real.GetType().GetName().startswith("object"):
                sbtype, _ = _marker_type(self.value, members_addr)
                if sbtype is not None:
                    mem_real = self.value.CreateValueFromAddress("*", members_addr, sbtype).GetNonSyntheticValue()
            mem_fields = _fields_of(mem_real.GetType())
            mem_children = {}
            if core.is_number_list_fields(mem_fields):
                mp = NumberListProvider(mem_real, None)
                mp.update()
                for child in mp.items:
                    mem_children[child.GetName()] = child
            elif core.is_list_fields(mem_fields):
                mp = ListProvider(mem_real, None)
                mp.update()
                if mp.inner is not None:
                    for child in mp.inner.slots:
                        mem_children[child.GetName()] = child
            for out_idx, idx in enumerate(live):
                child = mem_children.get("[%d]" % idx)
                if child is not None:
                    self.items.append(child.Clone("[%d]" % out_idx))
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


def _general_parts(value):
    tag = value.GetChildMemberWithName("tag").GetValueAsUnsigned()
    raw = value.GetChildMemberWithName("payload").GetData().GetUnsignedInt64(lldb.SBError(), 0)
    return tag, raw


def general_summary(value, internal_dict):
    # The raw tag and payload: GeneralProvider's children replace them.
    value = value.GetNonSyntheticValue()
    try:
        tag, raw = _general_parts(value)
        return core.general_text(_value_inferior(value), tag, raw)
    except TintError as error:
        return "<%s>" % error


class GeneralProvider(object):
    """A general value holding an object: the object's fields, retyped
    from its header (other tags have no children)."""

    def __init__(self, value, internal_dict):
        self.value = value
        self.real = None
        self.updated = False

    def update(self):
        self.real = None
        self.updated = True
        try:
            raw_value = self.value.GetNonSyntheticValue()
            tag, raw = _general_parts(raw_value)
            if tag == 5 and raw:
                sbtype, name = _marker_type(raw_value, raw)
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
        # LLDB may ask before update() (LLVM 19's lldb-dap does, through
        # SBValue.MightHaveChildren, and hides the children on False).
        if not self.updated:
            self.update()
        return self.real is not None


def _fields_of(sbtype):
    if sbtype.IsPointerType():
        sbtype = sbtype.GetPointeeType()
    return core.payload_fields(sbtype.GetFieldAtIndex(i).GetName() for i in range(sbtype.GetNumberOfFields()))


def is_list_type(sbtype, internal_dict):
    return core.is_list_fields(_fields_of(sbtype))


def is_number_list_type(sbtype, internal_dict):
    return core.is_number_list_fields(_fields_of(sbtype))


def is_entry_chain_type(sbtype, internal_dict):
    return core.is_entry_chain_fields(_fields_of(sbtype))


def is_dense_map_type(sbtype, internal_dict):
    return core.is_dense_map_fields(_fields_of(sbtype))


def is_dense_set_type(sbtype, internal_dict):
    return core.is_dense_set_fields(_fields_of(sbtype))


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
        "type summary add -w tint -F %s.map_summary --recognizer-function %s.is_dense_map_type" % (module, module),
        "type synthetic add -w tint -l %s.DenseMapProvider --recognizer-function %s.is_dense_map_type"
        % (module, module),
        "type summary add -w tint -F %s.map_summary --recognizer-function %s.is_dense_set_type" % (module, module),
        "type synthetic add -w tint -l %s.DenseSetProvider --recognizer-function %s.is_dense_set_type"
        % (module, module),
    ]
    for command in commands:
        result = lldb.SBCommandReturnObject()
        debugger.GetCommandInterpreter().HandleCommand(command, result)
        if not result.Succeeded():
            print("tint: %s: %s" % (command, result.GetError()))


def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand("command script add -o -f %s.heap_command tint-heap" % __name__)
    register_formatters(debugger)
