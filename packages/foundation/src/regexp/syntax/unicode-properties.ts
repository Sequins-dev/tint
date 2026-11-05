import { categoryAliases, scriptAliases } from "./unicode-property-data.ts";
// ECMAScript Table 66 is an explicit whitelist, not every UCD binary property.
// https://tc39.es/ecma262/multipage/text-processing.html#table-binary-unicode-properties
const binaryAliases: readonly string[] = [
  "AHex",
  "ASCII_Hex_Digit",
  "ASCII",
  "ASCII",
  "ASCII_Hex_Digit",
  "ASCII_Hex_Digit",
  "Alpha",
  "Alphabetic",
  "Alphabetic",
  "Alphabetic",
  "Any",
  "Any",
  "Assigned",
  "Assigned",
  "Bidi_C",
  "Bidi_Control",
  "Bidi_Control",
  "Bidi_Control",
  "Bidi_M",
  "Bidi_Mirrored",
  "Bidi_Mirrored",
  "Bidi_Mirrored",
  "CI",
  "Case_Ignorable",
  "CWCF",
  "Changes_When_Casefolded",
  "CWCM",
  "Changes_When_Casemapped",
  "CWKCF",
  "Changes_When_NFKC_Casefolded",
  "CWL",
  "Changes_When_Lowercased",
  "CWT",
  "Changes_When_Titlecased",
  "CWU",
  "Changes_When_Uppercased",
  "Case_Ignorable",
  "Case_Ignorable",
  "Cased",
  "Cased",
  "Changes_When_Casefolded",
  "Changes_When_Casefolded",
  "Changes_When_Casemapped",
  "Changes_When_Casemapped",
  "Changes_When_Lowercased",
  "Changes_When_Lowercased",
  "Changes_When_NFKC_Casefolded",
  "Changes_When_NFKC_Casefolded",
  "Changes_When_Titlecased",
  "Changes_When_Titlecased",
  "Changes_When_Uppercased",
  "Changes_When_Uppercased",
  "DI",
  "Default_Ignorable_Code_Point",
  "Dash",
  "Dash",
  "Default_Ignorable_Code_Point",
  "Default_Ignorable_Code_Point",
  "Dep",
  "Deprecated",
  "Deprecated",
  "Deprecated",
  "Dia",
  "Diacritic",
  "Diacritic",
  "Diacritic",
  "EBase",
  "Emoji_Modifier_Base",
  "EComp",
  "Emoji_Component",
  "EMod",
  "Emoji_Modifier",
  "EPres",
  "Emoji_Presentation",
  "Emoji",
  "Emoji",
  "Emoji_Component",
  "Emoji_Component",
  "Emoji_Modifier",
  "Emoji_Modifier",
  "Emoji_Modifier_Base",
  "Emoji_Modifier_Base",
  "Emoji_Presentation",
  "Emoji_Presentation",
  "Ext",
  "Extender",
  "ExtPict",
  "Extended_Pictographic",
  "Extended_Pictographic",
  "Extended_Pictographic",
  "Extender",
  "Extender",
  "Gr_Base",
  "Grapheme_Base",
  "Gr_Ext",
  "Grapheme_Extend",
  "Grapheme_Base",
  "Grapheme_Base",
  "Grapheme_Extend",
  "Grapheme_Extend",
  "Hex",
  "Hex_Digit",
  "Hex_Digit",
  "Hex_Digit",
  "IDC",
  "ID_Continue",
  "IDS",
  "ID_Start",
  "IDSB",
  "IDS_Binary_Operator",
  "IDST",
  "IDS_Trinary_Operator",
  "IDS_Binary_Operator",
  "IDS_Binary_Operator",
  "IDS_Trinary_Operator",
  "IDS_Trinary_Operator",
  "ID_Continue",
  "ID_Continue",
  "ID_Start",
  "ID_Start",
  "Ideo",
  "Ideographic",
  "Ideographic",
  "Ideographic",
  "Join_C",
  "Join_Control",
  "Join_Control",
  "Join_Control",
  "LOE",
  "Logical_Order_Exception",
  "Logical_Order_Exception",
  "Logical_Order_Exception",
  "Lower",
  "Lowercase",
  "Lowercase",
  "Lowercase",
  "Math",
  "Math",
  "NChar",
  "Noncharacter_Code_Point",
  "Noncharacter_Code_Point",
  "Noncharacter_Code_Point",
  "Pat_Syn",
  "Pattern_Syntax",
  "Pat_WS",
  "Pattern_White_Space",
  "Pattern_Syntax",
  "Pattern_Syntax",
  "Pattern_White_Space",
  "Pattern_White_Space",
  "QMark",
  "Quotation_Mark",
  "Quotation_Mark",
  "Quotation_Mark",
  "RI",
  "Regional_Indicator",
  "Radical",
  "Radical",
  "Regional_Indicator",
  "Regional_Indicator",
  "SD",
  "Soft_Dotted",
  "STerm",
  "Sentence_Terminal",
  "Sentence_Terminal",
  "Sentence_Terminal",
  "Soft_Dotted",
  "Soft_Dotted",
  "Term",
  "Terminal_Punctuation",
  "Terminal_Punctuation",
  "Terminal_Punctuation",
  "UIdeo",
  "Unified_Ideograph",
  "Unified_Ideograph",
  "Unified_Ideograph",
  "Upper",
  "Uppercase",
  "Uppercase",
  "Uppercase",
  "VS",
  "Variation_Selector",
  "Variation_Selector",
  "Variation_Selector",
  "White_Space",
  "White_Space",
  "XIDC",
  "XID_Continue",
  "XIDS",
  "XID_Start",
  "XID_Continue",
  "XID_Continue",
  "XID_Start",
  "XID_Start",
  "space",
  "White_Space",
];
export interface UnicodeProperty {
  readonly property: string;
  readonly value: string;
  readonly strings: boolean;
}
function lookup(table: readonly string[], name: string): string | undefined {
  let low = 0,
    high = table.length / 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const alias = table[middle * 2];
    if (alias === undefined) return undefined;
    if (alias < name) low = middle + 1;
    else if (alias > name) high = middle;
    else return table[middle * 2 + 1];
  }
  return undefined;
}
/** Exact ECMAScript aliases: deliberately no loose Unicode name matching. */
export function unicodeProperty(
  expression: string,
  allowStrings: boolean = false,
): UnicodeProperty | undefined {
  if (
    allowStrings &&
    [
      "Basic_Emoji",
      "Emoji_Keycap_Sequence",
      "RGI_Emoji_Modifier_Sequence",
      "RGI_Emoji_Flag_Sequence",
      "RGI_Emoji_Tag_Sequence",
      "RGI_Emoji_ZWJ_Sequence",
      "RGI_Emoji",
    ].includes(expression)
  )
    return { property: expression, value: "", strings: true };
  const equal = expression.indexOf("=");
  if (equal < 0) {
    const category = lookup(categoryAliases, expression);
    if (category !== undefined)
      return { property: "General_Category", value: category, strings: false };
    const binary = lookup(binaryAliases, expression);
    if (binary !== undefined)
      return { property: binary, value: "", strings: false };
    return undefined;
  }
  const name = expression.slice(0, equal),
    alias = expression.slice(equal + 1);
  let property = "";
  let values = categoryAliases;
  if (name === "gc" || name === "General_Category")
    property = "General_Category";
  else if (name === "sc" || name === "Script") {
    property = "Script";
    values = scriptAliases;
  } else if (name === "scx" || name === "Script_Extensions") {
    property = "Script_Extensions";
    values = scriptAliases;
  } else return undefined;
  const value = lookup(values, alias);
  return value === undefined ? undefined : { property, value, strings: false };
}
