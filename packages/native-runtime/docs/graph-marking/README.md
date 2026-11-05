# @tint/native-runtime/graph

`markIndexedGraph(graph, marks, pending, maxSteps = 1000000)` uses a caller-supplied
Uint8Array for mark states and Uint32Array for its worklist. It allocates no objects,
arrays, closures or result wrappers and does not resize either buffer. Nodes are
dense inventory indices, not addresses; the adapter must resolve exact owned
references before exposing indices. Absent edges use `-1`; `undefined` means a read
failure. Root/edge counts and indices must be uint32 values within their domains.

Only `complete` authorizes reading the resulting marks for sweep: 2 means reachable,
0 means unreachable. Nodes are marked when enqueued, avoiding duplicate worklist
entries even through cycles. Each root, processed node and edge costs one budget unit.
Caller storage bounds traversal independently of that work budget. Initialization and
failure cleanup additionally cost O(mark buffer length); callbacks must themselves be
bounded. A 20,000-node chain works with a one-entry worklist, while a wide graph may
need more. Insufficient storage returns `capacity`; it does not grow the worklist.

After traversal starts, any failure clears provisional marks; reader exceptions clear
marks and propagate. Invalid arguments detected before traversal leave buffers alone.
**Never sweep from failed or stale marks**, including all-zero marks following failure.
Reuse buffers only after their previous result is consumed. Pending contents are scratch
and have no meaning after return. Overlapping mark/worklist views are rejected.

Readers must be noncollecting, nonreentrant and stable throughout marking and sweep.
Both buffers must be exclusively borrowed, fixed-size, nondetached, and outside the
managed heap, with no alias to graph data. Native effect verification and raw-storage
lowering must enforce these requirements; this API alone cannot enforce callback
effects. `planCollection` remains the allocating reference implementation and is not
called by this kernel. The native-tracing package connects descriptor scans to the
streaming marker; native-heap owns allocation inventory and sweep.

The native indexed-marking fixture executes cycles and absent roots twice against
an exact allocation budget. All allocation belongs to setup (graph, callbacks and
workspaces); marking itself requires no managed allocation. The negative sentinel
keeps callback results in the unboxed optional-number ABI. This verifies the kernel,
not native heap inventory or descriptor traversal integration.

`createGraphMarker(graph, marks, pending)` supplies the streaming alternative for
readers whose edges are naturally visited sequentially. Construct its control state
outside the managed heap; repeated `marker.mark(maxSteps)` calls allocate no objects
and reuse one visitor. `scanEdges(node, visit)` must stop on false, synchronously
return a status, and never retain/reenter the visitor. Each emitted edge consumes
the same budget unit as an indexed edge. Visitor failures take precedence over a
scanner's return status and provisional marks are cleared on failure or exception.
Both traversal forms share index validation, enqueueing and failure semantics.
