// Counts Map/Set operations by key kind and size: a proxy for native LinkedMap/LinkedSet cost.
const stats = { map: { str: 0, num: 0, obj: 0, other: 0, objLinearCost: 0, objOps9: 0 }, set: { str: 0, num: 0, obj: 0, other: 0, objLinearCost: 0, objOps9: 0, strLinearCostOld: 0 } };
const kind = (k) => typeof k === "string" ? "str" : typeof k === "number" ? "num" : (typeof k === "object" || typeof k === "function") && k !== null ? "obj" : "other";
let active = true;
function wrap(proto, name, bucket) {
  const orig = proto[name];
  proto[name] = function (key, ...rest) {
    if (active) {
      active = false;
      const s = stats[bucket], k = kind(key), n = this.size;
      s[k]++;
      if (k === "obj") { s.objLinearCost += n; if (n > 8) s.objOps9++; }
      if (bucket === "set" && k !== "obj") s.strLinearCostOld += n;
      active = true;
    }
    return orig.call(this, key, ...rest);
  };
}
for (const n of ["get", "set", "has", "delete"]) wrap(Map.prototype, n, "map");
for (const n of ["add", "has", "delete"]) wrap(Set.prototype, n, "set");
process.on("exit", () => console.log("SIZING", JSON.stringify(stats)));
