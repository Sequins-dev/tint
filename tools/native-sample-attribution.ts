/** Exact exclusive counts from Apple's sample call tree, including counts below
 * the five-sample threshold of its printed leaf summary. Other threads and the
 * recursive inclusive summary are deliberately excluded. */
export function attributeNativeSample(text: string): {
  samples: number;
  leafGroups: readonly {
    function: string;
    samples: number;
    percent: number;
  }[];
} {
  const stack: {
    depth: number;
    name: string;
    count: number;
    children: number;
  }[] = [];
  const groups = new Map<string, number>();
  let samples = 0,
    inGraph = false,
    main = false;
  function finish(): void {
    const frame = stack.pop();
    if (frame === undefined) return;
    const own = frame.count - frame.children;
    if (own < 0)
      throw new Error("sample children exceed parent: " + frame.name);
    if (own > 0) groups.set(frame.name, (groups.get(frame.name) ?? 0) + own);
  }
  for (const line of text.split("\n")) {
    if (line === "Call graph:") {
      inGraph = true;
      continue;
    }
    if (!inGraph) continue;
    const match = /^([ +!:|]*)([0-9]+) (.+)$/.exec(line);
    if (match === null) {
      if (/^(Total number|Sort by|Binary Images:)/.test(line)) break;
      continue;
    }
    const depth = match[1]!.length,
      count = Number(match[2]),
      label = match[3]!;
    if (label.startsWith("Thread_")) {
      while (stack.length > 0) finish();
      if (main) break;
      main = label.includes("com.apple.main-thread");
      if (main) samples = count;
    }
    if (!main) continue;
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth)
      finish();
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.children += count;
    const name = label.replace(/\s+\(in .*$/, "").replace(/ \[.*$/, "");
    stack.push({ depth, count, name, children: 0 });
  }
  while (stack.length > 0) finish();
  if (samples === 0) throw new Error("sample has no native main thread");
  return {
    samples,
    leafGroups: [...groups]
      .map(([name, count]) => ({
        function: name,
        samples: count,
        percent: (100 * count) / samples,
      }))
      .sort(
        (a, b) => b.samples - a.samples || a.function.localeCompare(b.function),
      ),
  };
}
