import assert from "node:assert/strict";
import test from "node:test";
import {
  attributes,
  parseCldrElements,
  cldrPath,
  resolveCldrAliasPath,
  createCldrLocaleResolver,
} from "./cldr-xml.ts";

test("CLDR attributes retain digits, namespace names and either XML quote style", () => {
  assert.deepEqual(
    [...attributes(` iso3166="DE" xml:space='preserve' type="A &amp; B"`)],
    [
      ["iso3166", "DE"],
      ["xml:space", "preserve"],
      ["type", "A & B"],
    ],
  );
});

test("CLDR tree extraction preserves text, entities and quoted tag delimiters", () => {
  const root = parseCldrElements(
    `<?xml version="1.0"?><!DOCTYPE ldml SYSTEM "x"><ldml><!--x--><item type="a>b"> A &amp; B </item></ldml>`,
  );
  assert.equal(root.name, "ldml");
  assert.equal(root.children[0]?.attributes.get("type"), "a>b");
  assert.equal(root.children[0]?.text, " A & B ");
  assert.throws(() => parseCldrElements("<ldml><x></ldml>"));
  assert.throws(() => parseCldrElements("<ldml><!--unfinished"));
});
test("CLDR aliases resolve quoted slash selectors and explicit relative paths", () => {
  const context = cldrPath("dates/timeZoneNames/zone[@type='Other/Zone']/long");
  assert.deepEqual(
    resolveCldrAliasPath(context, "../../zone[@type='Etc/UTC']/long"),
    cldrPath("dates/timeZoneNames/zone[@type='Etc/UTC']/long"),
  );
  assert.throws(() => resolveCldrAliasPath([], "../dates"));
  assert.throws(() => cldrPath("dates/zone[@type='unfinished]"));
});
test("CLDR aliases observe the DTD's implicit standard format type", () => {
  const root = parseCldrElements(
    `<ldml><dateTimeFormatLength type="short"><dateTimeFormat><pattern>standard</pattern></dateTimeFormat><dateTimeFormat type="atTime"><alias source="locale" path="../dateTimeFormat[@type='standard']"/></dateTimeFormat></dateTimeFormatLength><timeFormat type="standard"><pattern type="standard">explicit</pattern></timeFormat></ldml>`,
  );
  const resolver = createCldrLocaleResolver(
    new Map([["root", root]]),
    () => undefined,
  );
  assert.equal(
    resolver.value(
      "root",
      cldrPath(
        "dateTimeFormatLength[@type='short']/dateTimeFormat[@type='atTime']/pattern",
      ),
    ),
    "standard",
  );
  assert.equal(
    resolver.value("root", cldrPath("timeFormat/pattern")),
    "explicit",
  );
});
test("CLDR extraction rejects declarations it cannot interpret", () => {
  assert.throws(
    () => parseCldrElements("<ldml><![CDATA[discarded]]></ldml>"),
    /declaration/i,
  );
  assert.throws(() => parseCldrElements("outside<ldml/>"), /document/i);
});
test("an inherited calendar alias resolves in the originally requested locale", () => {
  const root = parseCldrElements(
    `<ldml><dates><calendars><calendar type="buddhist"><months><alias source="locale" path="../../calendar[@type='gregorian']/months"/></months></calendar><calendar type="gregorian"><months><month type="1">Root</month></months></calendar></calendars></dates></ldml>`,
  );
  const en = parseCldrElements(
    `<ldml><dates><calendars><calendar type="gregorian"><months><month type="1">January</month></months></calendar></calendars></dates></ldml>`,
  );
  const resolver = createCldrLocaleResolver(
    new Map([
      ["root", root],
      ["en", en],
    ]),
    (name) => (name === "en-GB" ? "en" : name === "en" ? "root" : undefined),
  );
  assert.equal(
    resolver.value(
      "en-GB",
      cldrPath(
        "dates/calendars/calendar[@type='buddhist']/months/month[@type='1']",
      ),
    ),
    "January",
  );
});
test("CLDR leaf resolution observes inheritance and no-inheritance markers", () => {
  const locales = new Map([
    ["root", parseCldrElements("<ldml><a>parent</a><b>parent</b></ldml>")],
    ["x", parseCldrElements("<ldml><a>↑↑↑</a><b>∅∅∅</b></ldml>")],
  ]);
  const resolver = createCldrLocaleResolver(locales, (name) =>
    name === "x" ? "root" : undefined,
  );
  assert.equal(resolver.value("x", cldrPath("a")), "parent");
  assert.equal(resolver.value("x", cldrPath("b")), "");
});
test("CLDR selectors distinguish leap names and ignore alternate labels", () => {
  const root = parseCldrElements(
    `<ldml><months><month type="7" alt="variant">Wrong</month><month type="7">Adar</month><month type="7" yeartype="leap">Adar II</month></months></ldml>`,
  );
  const resolver = createCldrLocaleResolver(
    new Map([["root", root]]),
    () => undefined,
  );
  assert.equal(
    resolver.value("root", cldrPath("months/month[@type='7']")),
    "Adar",
  );
  assert.equal(
    resolver.value(
      "root",
      cldrPath("months/month[@type='7'][@yeartype='leap']"),
    ),
    "Adar II",
  );
});
test("append-item requests remain distinguishing attributes", () => {
  const root = parseCldrElements(
    `<ldml><appendItems><appendItem request="Year">year</appendItem><appendItem request="Second">second</appendItem></appendItems></ldml>`,
  );
  const resolver = createCldrLocaleResolver(
    new Map([["root", root]]),
    () => undefined,
  );
  assert.equal(
    resolver.value(
      "root",
      cldrPath("appendItems/appendItem[@request='Second']"),
    ),
    "second",
  );
});
test("an explicit alternate selector can read a short territory label", () => {
  const root = parseCldrElements(
    `<ldml><territories><territory type="GB">United Kingdom</territory><territory type="GB" alt="short">UK</territory></territories></ldml>`,
  );
  const resolver = createCldrLocaleResolver(
    new Map([["root", root]]),
    () => undefined,
  );
  assert.equal(
    resolver.value("root", cldrPath("territories/territory[@type='GB']")),
    "United Kingdom",
  );
  assert.equal(
    resolver.value(
      "root",
      cldrPath("territories/territory[@type='GB'][@alt='short']"),
    ),
    "UK",
  );
});
test("CLDR resolver rejects alias and parent cycles and allows bounded cache reuse", () => {
  const root = parseCldrElements(
    `<ldml><a><alias source="locale" path="../b"/></a><b><alias source="locale" path="../a"/></b></ldml>`,
  );
  const resolver = createCldrLocaleResolver(
    new Map([["root", root]]),
    () => undefined,
  );
  assert.throws(() => resolver.value("root", cldrPath("a")), /cycle/i);
  const parentCycle = createCldrLocaleResolver(new Map(), (name) => name);
  assert.throws(() => parentCycle.value("x", cldrPath("a")), /cycle/i);
  const locales = new Map([
    ["root", parseCldrElements("<ldml><a>first</a></ldml>")],
  ]);
  const cached = createCldrLocaleResolver(locales, () => undefined);
  assert.equal(cached.value("root", cldrPath("a")), "first");
  locales.set("root", parseCldrElements("<ldml><a>second</a></ldml>"));
  cached.clear();
  assert.equal(cached.value("root", cldrPath("a")), "second");
});
