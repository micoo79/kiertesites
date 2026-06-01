"""
Kiértesítés-generátor – Pyodide/web változat.

Az eredeti Tkinter-alapú asztali alkalmazás magfüggvényei, fájlrendszer- és
GUI-függés nélkül. A bemeneti fájlokat bájtsorozatként kapja, és a kimeneteket
is bájtsorozatként adja vissza, hogy a böngészőben futtatható legyen.
"""

from __future__ import annotations

import copy
import dataclasses
import datetime as _dt
import io
import re
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


# ---------------------------------------------------------------------------
# Adatmodellek
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class Recipient:
    name: str
    address: str
    role: str = "tulajdonos"
    source_file: str = ""
    settlement: str = ""

    @property
    def key(self) -> Tuple[str, str]:
        return (normalize_key(self.name), normalize_key(self.address))

    def to_dict(self) -> Dict[str, str]:
        return {
            "name": self.name,
            "address": self.address,
            "role": self.role,
            "source_file": self.source_file,
            "settlement": self.settlement,
        }


@dataclasses.dataclass
class ParsedSheet:
    source_file: str
    settlement: str = ""
    hrsz: str = ""
    recipients: List[Recipient] = dataclasses.field(default_factory=list)


# ---------------------------------------------------------------------------
# Általános segédfüggvények
# ---------------------------------------------------------------------------

def normalize_key(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().casefold()


def clean_value(value: str) -> str:
    value = (value or "").replace(" ", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\s+\n", "\n", value)
    value = re.sub(r"\n\s+", "\n", value)
    value = re.sub(r"\n+", " ", value)
    value = re.sub(r"\s{2,}", " ", value)
    return value.strip(" ;,.\t\r\n")


def title_for_sheet(name: str, index: int) -> str:
    safe = re.sub(r"[:\\/?*\[\]]+", " ", name or f"Címzett {index}")
    safe = re.sub(r"\s+", " ", safe).strip()
    if not safe:
        safe = f"Címzett {index}"
    prefix = f"{index:02d} "
    max_len = 31 - len(prefix)
    return (prefix + safe[:max_len]).strip()


def today_hu() -> str:
    return _dt.date.today().strftime("%Y.%m.%d.")


# ---------------------------------------------------------------------------
# Fájlbeolvasás bájtokból
# ---------------------------------------------------------------------------

def decode_text_bytes(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1250", "iso-8859-2", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def extract_pdf_text_from_bytes(data: bytes, filename: str = "") -> str:
    """PDF bájtokból szöveg kinyerése pypdf-fel."""
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError(
            "Hiányzik a pypdf könyvtár a böngészős futtatókörnyezetből."
        ) from exc

    try:
        reader = PdfReader(io.BytesIO(data))
        chunks = []
        for page in reader.pages:
            chunks.append(page.extract_text() or "")
        text = "\n".join(chunks).strip()
        if text:
            return text
    except Exception as exc:
        raise RuntimeError(
            f"Nem sikerült szöveget kinyerni ebből a PDF-ből: {filename}\n"
            f"Részletek: {exc}"
        ) from exc

    raise RuntimeError(f"Üres PDF szöveg: {filename}")


def read_property_sheet_bytes(data: bytes, filename: str) -> str:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return extract_pdf_text_from_bytes(data, filename=filename)
    if lower.endswith(".txt"):
        return decode_text_bytes(data)
    raise ValueError(f"Nem támogatott fájltípus: {filename}")


# ---------------------------------------------------------------------------
# Tulajdoni lap parser (változatlan logika az eredetiből)
# ---------------------------------------------------------------------------

SECTION_PATTERNS = {
    "I": re.compile(r"\bI\.\s*R[ÉE]SZ\b", re.IGNORECASE),
    "II": re.compile(r"\bII\.\s*R[ÉE]SZ\b", re.IGNORECASE),
    "III": re.compile(r"\bIII\.\s*R[ÉE]SZ\b", re.IGNORECASE),
}


def normalize_lines(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace(" ", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line)


def get_section(text: str, start_roman: str, end_roman: Optional[str] = None) -> str:
    start_match = SECTION_PATTERNS[start_roman].search(text)
    if not start_match:
        return ""
    start = start_match.end()
    if end_roman:
        end_match = SECTION_PATTERNS[end_roman].search(text, start)
        end = end_match.start() if end_match else len(text)
    else:
        end = len(text)
    return text[start:end]


def extract_settlement(text: str) -> str:
    normalized = normalize_lines(text)

    patterns = [
        r"\btelep[üu]l[ée]s\s*[:\-]\s*([A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű .'\-]+)",
        r"\bközs[ée]g\s*[:\-]\s*([A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű .'\-]+)",
        r"\bváros\s*[:\-]\s*([A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű .'\-]+)",
    ]
    for pat in patterns:
        match = re.search(pat, normalized, flags=re.IGNORECASE)
        if match:
            return clean_value(match.group(1)).split(" ")[0] if "\n" not in match.group(1) else clean_value(match.group(1))

    match = re.search(
        r"(?m)^([A-ZÁÉÍÓÖŐÚÜŰ][A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű .'\-]{1,50})\s*\n"
        r"\s*(?:Belterület|Külterület|Zártkert),?\s+[0-9A-Za-z/.\-]+\s+helyrajzi\s+szám\b",
        normalized,
        flags=re.IGNORECASE,
    )
    if match:
        candidate = clean_value(match.group(1))
        if candidate and not re.search(r"\boldal\b|\bügyazonosító\b|\d{4}", candidate, flags=re.IGNORECASE):
            return candidate

    match = re.search(
        r"(?m)^([A-ZÁÉÍÓÖŐÚÜŰ][A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű .'\-]{1,50}?),\s*"
        r"(?:Belterület|Külterület|Zártkert),?\s+[0-9A-Za-z/.\-]+\s*$",
        normalized,
        flags=re.IGNORECASE,
    )
    if match:
        return clean_value(match.group(1))

    match = re.search(
        r"(?m)^([A-ZÁÉÍÓÖŐÚÜŰ][A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű .'\-]{1,50}?)\s+"
        r"(?:belterület|külterület|zártkert)\s+"
        r"[0-9A-Za-z/.-]+\s+helyrajzi\s+szám\b",
        normalized,
        flags=re.IGNORECASE,
    )
    if match:
        return clean_value(match.group(1))

    match = re.search(
        r"(?m)^([A-ZÁÉÍÓÖŐÚÜŰ][A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű .'\-]{1,50}?)\s+"
        r"[0-9A-Za-z/.-]+\s+(?:hrsz\.?|helyrajzi)",
        normalized,
        flags=re.IGNORECASE,
    )
    if match:
        return clean_value(match.group(1))

    match = re.search(
        r"\b\d{4}\s+([A-ZÁÉÍÓÖŐÚÜŰ][A-ZÁÉÍÓÖŐÚÜŰ \-]{1,40}?),\s",
        normalized,
    )
    if match:
        return clean_value(match.group(1)).title()

    return ""


def extract_hrsz(text: str) -> str:
    normalized = normalize_lines(text)
    patterns = [
        r"\b([0-9]{1,8}(?:/[0-9A-Za-z]+)*(?:-[0-9A-Za-z]+)?)\s+helyrajzi\s+szám\b",
        r"\bhrsz\.?\s*[:\-]?\s*([0-9]{1,8}(?:/[0-9A-Za-z]+)*(?:-[0-9A-Za-z]+)?)\b",
        r"\bhelyrajzi\s+szám\s*[:\-]?\s*([0-9]{1,8}(?:/[0-9A-Za-z]+)*(?:-[0-9A-Za-z]+)?)\b",
    ]
    for pat in patterns:
        match = re.search(pat, normalized, flags=re.IGNORECASE)
        if match:
            return clean_value(match.group(1))
    return ""


def split_numbered_blocks(section: str) -> List[str]:
    section = normalize_lines(section)
    if not section:
        return []

    matches = list(re.finditer(r"(?m)^\s*\d+\.\s+", section))
    if matches:
        blocks = []
        for i, match in enumerate(matches):
            start = match.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(section)
            blocks.append(section[start:end].strip())
        return blocks

    parts = re.split(r"(?=\b\d+\.\s+(?:tulajdoni|bejegyző|jog|haszonélvezeti))", section, flags=re.IGNORECASE)
    return [p.strip() for p in parts if p.strip()]


FIELD_END = (
    r"(?=\s+(?:szül(?:etési)?\.?\s*név|születési\s+név|szül\.?|"
    r"születési\s+év|anyja\s+neve|"
    r"jogosult\s+címe|cím|lakcím|értesítési\s+cím|"
    r"jogcím|jogváltozás\s+jogcíme|jogállás|tulajdoni\s+hányad|"
    r"utalás(?:\s+a\s+törölt\s+bejegyzésre|\s+az\s+eredeti\s+bejegyzésre)?|"
    r"jog\s+terjedelme|változás\s+keletkezésének\s+időpontja|"
    r"eredeti\s+bejegyzés/szerzés\s+iktatószáma|"
    r"bejegyző|érkezési\s+idő|jogosult|név)\s*:|"
    r"\s+bejegyző\s+határozat\b|"
    r"\s+folytatás\s+a\s+következő\s+oldalon\b|"
    r"\s+tulajdoni\s+lap\s+vége\b|"
    r"\s*$)"
)


def extract_field(block: str, field_names: Sequence[str]) -> str:
    block_one_line = re.sub(r"\s+", " ", block).strip()

    for name in field_names:
        escaped = re.escape(name)
        if normalize_key(name) == "név":
            pat = rf"(?<!születési\s)(?<!szül\.\s)(?<!szül\s)\b{escaped}\s*:\s*(.+?){FIELD_END}"
        else:
            pat = rf"\b{escaped}\s*:\s*(.+?){FIELD_END}"
        match = re.search(pat, block_one_line, flags=re.IGNORECASE)
        if match:
            value = clean_value(match.group(1))
            if value:
                return value

    for line in block.splitlines():
        for name in field_names:
            if re.match(rf"^\s*{re.escape(name)}\s*:", line, flags=re.IGNORECASE):
                return clean_value(line.split(":", 1)[1])

    return ""


def extract_name_from_block(block: str, prefer_after_jogosult: bool = False) -> str:
    if prefer_after_jogosult:
        match = re.search(r"\bjogosult\s*:?\s*(.+)$", block, flags=re.IGNORECASE | re.DOTALL)
        if match:
            value = extract_field(match.group(1), ["név", "jogosult neve"])
            if value:
                return value

    value = extract_field(block, ["név", "tulajdonos neve", "jogosult neve"])
    if value:
        return value

    match = re.search(
        r"\bjogosult\s*:?\s*([A-ZÁÉÍÓÖŐÚÜŰ][^:]{2,80}?)(?=\s+(?:cím|lakcím)\s*:|$)",
        re.sub(r"\s+", " ", block),
        flags=re.IGNORECASE,
    )
    if match:
        candidate = clean_value(match.group(1))
        candidate = re.sub(r"^(név\s*:)\s*", "", candidate, flags=re.IGNORECASE)
        return candidate

    return ""


def extract_address_from_block(block: str) -> str:
    value = extract_field(block, ["jogosult címe", "cím", "lakcím", "értesítési cím"])
    if value:
        return _strip_country_prefix(value)

    match = re.search(
        r"\b(\d{4}\s+[A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű .'\-]+?\s+"
        r"(?:utca|u\.|út|tér|köz|körút|sor|dűlő|dulo|hrsz|helyrajzi|lakótelep|lktp\.)"
        r"[^.;]*)",
        re.sub(r"\s+", " ", block),
        flags=re.IGNORECASE,
    )
    if match:
        return _strip_country_prefix(clean_value(match.group(1)))

    return ""


def _strip_country_prefix(address: str) -> str:
    return re.sub(r"^\s*Magyarország[,\s]+", "", address, flags=re.IGNORECASE).strip()


def parse_owners(ii_section: str, source_file: str, settlement: str) -> List[Recipient]:
    recipients: List[Recipient] = []
    for block in split_numbered_blocks(ii_section):
        if not re.search(r"\b(tulajdonos|vagyonkezelő|vagyonkezelo)\b", block, flags=re.IGNORECASE):
            if not (re.search(r"\bnév\s*:", block, flags=re.IGNORECASE) and re.search(r"\bcím\s*:", block, flags=re.IGNORECASE)):
                continue

        name = extract_name_from_block(block)
        address = extract_address_from_block(block)

        if name or address:
            role = "vagyonkezelő" if re.search(r"\bvagyonkezelő|vagyonkezelo\b", block, flags=re.IGNORECASE) else "tulajdonos"
            recipients.append(
                Recipient(
                    name=name,
                    address=address,
                    role=role,
                    source_file=source_file,
                    settlement=settlement,
                )
            )
    return recipients


def parse_usufructuaries(iii_section: str, source_file: str, settlement: str) -> List[Recipient]:
    recipients: List[Recipient] = []
    for block in split_numbered_blocks(iii_section):
        if not re.search(
            r"\b(haszon[ée]lvezeti\s+jog|haszon[ée]lvező|haszon[ée]lvezo|"
            r"özvegyi\s+jog|tartási\s+jog|tartás)\b",
            block,
            flags=re.IGNORECASE,
        ):
            continue

        if re.search(r"\b(vezetékjog|szolgalmi\s+jog|jelzálogjog)\b", block, flags=re.IGNORECASE):
            continue

        name = extract_name_from_block(block, prefer_after_jogosult=True)
        address = extract_address_from_block(block)

        role = "haszonélvező"
        if re.search(r"\btartási\s+jog\b", block, flags=re.IGNORECASE):
            role = "tartási jog jogosultja"
        elif re.search(r"\bözvegyi\s+jog\b", block, flags=re.IGNORECASE):
            role = "özvegyi jog jogosultja"

        if name or address:
            recipients.append(
                Recipient(
                    name=name,
                    address=address,
                    role=role,
                    source_file=source_file,
                    settlement=settlement,
                )
            )
    return recipients


def parse_property_sheet(text: str, source_file: str) -> ParsedSheet:
    normalized = normalize_lines(text)
    settlement = extract_settlement(normalized)
    hrsz = extract_hrsz(normalized)

    ii = get_section(normalized, "II", "III")
    iii = get_section(normalized, "III", None)

    recipients = parse_owners(ii, source_file, settlement)
    recipients.extend(parse_usufructuaries(iii, source_file, settlement))

    return ParsedSheet(
        source_file=source_file,
        settlement=settlement,
        hrsz=hrsz,
        recipients=recipients,
    )


def deduplicate_recipients(recipients: Iterable[Recipient]) -> List[Recipient]:
    seen: set = set()
    result: List[Recipient] = []
    for r in recipients:
        key = r.key
        if key in seen:
            continue
        seen.add(key)
        result.append(r)
    return result


# ---------------------------------------------------------------------------
# RTF: beolvasás, látható szöveg leképezése, placeholder-csere
# ---------------------------------------------------------------------------

def detect_rtf_encoding(raw: bytes) -> str:
    header = raw[:500].decode("ascii", errors="ignore")
    match = re.search(r"\\ansicpg(\d+)", header)
    if match:
        cp = match.group(1)
        if cp == "1250":
            return "cp1250"
        return f"cp{cp}"
    return "cp1250"


def read_rtf_bytes(raw: bytes) -> Tuple[str, str]:
    encoding = detect_rtf_encoding(raw)
    try:
        return raw.decode(encoding), encoding
    except LookupError:
        return raw.decode("cp1250", errors="replace"), "cp1250"
    except UnicodeDecodeError:
        return raw.decode(encoding, errors="replace"), encoding


def rtf_to_bytes(content: str, encoding: str) -> bytes:
    return content.encode(encoding, errors="replace")


def rtf_escape(text: str) -> str:
    result: List[str] = []
    for ch in str(text):
        code = ord(ch)
        if ch == "\\":
            result.append(r"\\")
        elif ch == "{":
            result.append(r"\{")
        elif ch == "}":
            result.append(r"\}")
        elif ch == "\n":
            result.append(r"\line ")
        elif ch == "\t":
            result.append(r"\tab ")
        elif code < 128:
            result.append(ch)
        else:
            signed = code if code <= 32767 else code - 65536
            result.append(rf"\u{signed}?")
    return "".join(result)


@dataclasses.dataclass
class TextMapItem:
    char: str
    start: int
    end: int


def rtf_text_map(rtf: str, codepage: str = "cp1250") -> List[TextMapItem]:
    items: List[TextMapItem] = []
    i = 0
    n = len(rtf)

    while i < n:
        ch = rtf[i]

        if ch in "{}":
            i += 1
            continue

        if ch != "\\":
            items.append(TextMapItem(ch, i, i + 1))
            i += 1
            continue

        start = i
        i += 1
        if i >= n:
            break

        control = rtf[i]

        if control in "\\{}":
            items.append(TextMapItem(control, start, i + 1))
            i += 1
            continue

        if control == "'":
            hx = rtf[i + 1:i + 3]
            try:
                c = bytes.fromhex(hx).decode(codepage, errors="replace")
            except Exception:
                c = ""
            if c:
                items.append(TextMapItem(c, start, min(i + 3, n)))
            i = min(i + 3, n)
            continue

        if control.isalpha():
            word_start = i
            while i < n and rtf[i].isalpha():
                i += 1
            word = rtf[word_start:i]

            param_start = i
            if i < n and rtf[i] in "+-":
                i += 1
            while i < n and rtf[i].isdigit():
                i += 1
            param = rtf[param_start:i]

            if word == "u" and param:
                try:
                    num = int(param)
                    if num < 0:
                        num += 65536
                    items.append(TextMapItem(chr(num), start, i))
                except ValueError:
                    pass

                if i < n:
                    if rtf[i] == "\\" and i + 1 < n:
                        if rtf[i + 1] == "'":
                            i = min(i + 4, n)
                        else:
                            i = min(i + 2, n)
                    else:
                        i += 1
                continue

            elif word in {"line", "par"}:
                items.append(TextMapItem("\n", start, i))
            elif word == "tab":
                items.append(TextMapItem("\t", start, i))

            if i < n and rtf[i] == " ":
                i += 1
            continue

        if control == "~":
            items.append(TextMapItem(" ", start, i + 1))
        i += 1

    return items


PLACEHOLDER_RE = re.compile(
    r"\[\s*\[?\s*([0-9A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű_]+(?:\s*[0-9A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű_]+)*)\s*\]\s*\]",
    flags=re.UNICODE,
)

STAR_PLACEHOLDER_RE = re.compile(
    r"\[\s*\*\s*([^\*]+?)\s*\*\s*\]",
    flags=re.UNICODE | re.DOTALL,
)


def normalize_placeholder_name(name: str) -> str:
    return re.sub(r"\s+", "", name or "").strip()


def find_rtf_placeholders(rtf: str, codepage: str = "cp1250") -> List[str]:
    items = rtf_text_map(rtf, codepage=codepage)
    plain = "".join(item.char for item in items)
    names: List[str] = []
    for rex in (PLACEHOLDER_RE, STAR_PLACEHOLDER_RE):
        for match in rex.finditer(plain):
            name = normalize_placeholder_name(match.group(1))
            if name and name not in names:
                names.append(name)
    return names


def build_placeholder_aliases(values: Dict[str, str]) -> Dict[str, str]:
    aliases = dict(values)
    alias_pairs = {
        "keltezés": "keltezes",
        "tulajdonos_címe": "tulajdonos_cime",
        "cimzett_neve": "tulajdonos_neve",
        "címzett_neve": "tulajdonos_neve",
        "cimzett_cime": "tulajdonos_cime",
        "címzett_címe": "tulajdonos_cime",
        "cimzett_címe": "tulajdonos_cime",
        "címzett_cime": "tulajdonos_cime",
    }
    for alias, target in alias_pairs.items():
        if target in values and alias not in aliases:
            aliases[alias] = values[target]
    return aliases


def replace_rtf_placeholders(rtf: str, values: Dict[str, str], codepage: str = "cp1250") -> Tuple[str, List[str]]:
    items = rtf_text_map(rtf, codepage=codepage)
    plain = "".join(item.char for item in items)
    aliases = build_placeholder_aliases(values)

    replacements: List[Tuple[int, int, str]] = []
    missing: List[str] = []
    occupied: set = set()

    for rex in (PLACEHOLDER_RE, STAR_PLACEHOLDER_RE):
        for match in rex.finditer(plain):
            name = normalize_placeholder_name(match.group(1))
            if not name:
                continue
            span = (match.start(), match.end())
            if span in occupied:
                continue
            occupied.add(span)

            value = aliases.get(name)
            if value is None:
                if name not in missing:
                    missing.append(name)
                continue

            raw_start = items[match.start()].start
            raw_end = items[match.end() - 1].end
            replacements.append((raw_start, raw_end, rtf_escape(value)))

    replacements.sort(key=lambda x: x[0], reverse=True)
    for raw_start, raw_end, value in replacements:
        rtf = rtf[:raw_start] + value + rtf[raw_end:]

    return rtf, missing


def split_rtf_document(template: str) -> Tuple[str, str, str]:
    body_start_match = re.search(r"\\pard\b", template)
    if not body_start_match:
        raise ValueError("Nem található \\pard a RTF sablonban; nem tudom a törzset szétválasztani.")

    body_start = body_start_match.start()
    root_close = template.rfind("}")
    if root_close == -1:
        raise ValueError("Érvénytelen RTF sablon: nincs lezáró kapcsos zárójel.")

    return template[:body_start], template[body_start:root_close], template[root_close:]


def compact_plain_with_map(text: str) -> Tuple[str, List[int]]:
    chars: List[str] = []
    index_map: List[int] = []
    for idx, ch in enumerate(text):
        if ch.isspace():
            continue
        chars.append(ch.lower())
        index_map.append(idx)
    return "".join(chars), index_map


def remove_visible_span_by_compact_text(
    rtf: str,
    start_text: str,
    end_text: str,
    codepage: str = "cp1250",
    extend_to_paragraph: bool = True,
) -> str:
    items = rtf_text_map(rtf, codepage=codepage)
    if not items:
        return rtf

    plain = "".join(item.char for item in items)
    compact, compact_to_plain = compact_plain_with_map(plain)
    start_compact, _ = compact_plain_with_map(start_text)
    end_compact, _ = compact_plain_with_map(end_text)

    start_idx = compact.find(start_compact)
    if start_idx == -1:
        return rtf

    end_idx = compact.find(end_compact, start_idx)
    if end_idx == -1:
        return rtf

    plain_start = compact_to_plain[start_idx]
    plain_end = compact_to_plain[end_idx + len(end_compact) - 1] + 1

    raw_start = items[plain_start].start
    raw_end = items[plain_end - 1].end

    if extend_to_paragraph:
        par_start = rtf.rfind("\\pard", 0, raw_start)
        if par_start != -1:
            raw_start = par_start

        par_end = rtf.find("\\par", raw_end)
        if par_end != -1:
            raw_end = par_end + len("\\par")
            probe = raw_end
            while probe < len(rtf) and rtf[probe].isspace():
                probe += 1
            if probe < len(rtf) and rtf[probe] == "}":
                raw_end = probe + 1

    return rtf[:raw_start] + rtf[raw_end:]


def remove_acknowledgement_block(rtf: str, codepage: str = "cp1250") -> str:
    return remove_visible_span_by_compact_text(
        rtf,
        start_text="Kérem, az alábbi nyilatkozat aláírásával erősítse meg",
        end_text="Aláírás: _____________________________",
        codepage=codepage,
        extend_to_paragraph=True,
    )


def build_letters_rtf(
    template_rtf: str,
    codepage: str,
    recipients: Sequence[Recipient],
    global_values: Dict[str, str],
    postal: bool,
) -> str:
    prefix, body, suffix = split_rtf_document(template_rtf)

    if postal:
        body = remove_acknowledgement_block(body, codepage=codepage)

    pages: List[str] = []
    for recipient in recipients:
        values = dict(global_values)
        values.update(
            {
                "tulajdonos_neve": recipient.name,
                "tulajdonos_cime": recipient.address,
                "kozseg": recipient.settlement or global_values.get("kozseg", ""),
                "cimzett_neve": recipient.name,
                "cimzett_cime": recipient.address,
            }
        )

        page, missing = replace_rtf_placeholders(body, values, codepage=codepage)
        if missing:
            raise RuntimeError(
                "Kitöltetlen sablonmező maradt ennél a címzettnél: "
                f"{recipient.name or '[név nélkül]'}\n\n"
                + ", ".join(f"[[{name}]]" for name in missing)
            )
        pages.append(page)

    return prefix + "\n\\page\n".join(pages) + suffix


def validate_rtf_braces(rtf: str) -> bool:
    depth = 0
    escaped = False
    for ch in rtf:
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


# ---------------------------------------------------------------------------
# Boríték Excel generálás
# ---------------------------------------------------------------------------

def split_hungarian_address(address: str) -> Tuple[str, str, str]:
    address = clean_value(address)
    match = re.match(r"^\s*(\d{4})\s+(.+?)\s+(.+)$", address)
    if match:
        return clean_value(match.group(1)), clean_value(match.group(2)), clean_value(match.group(3))

    match = re.match(r"^\s*(\d{4})\s+([^,]+),\s*(.+)$", address)
    if match:
        return clean_value(match.group(1)), clean_value(match.group(2)), clean_value(match.group(3))

    return "", "", address


def replace_cell_text(value: str, recipient: Recipient) -> str:
    zip_code, city, street = split_hungarian_address(recipient.address)

    replacements = {
        "Gipsz jakab": recipient.name,
        "Gipsz Jakab": recipient.name,
        "gipsz jakab": recipient.name,
        "település": city,
        "Település": city,
        "utca és házszám": street,
        "Utca és házszám": street,
        "irányítószám": zip_code,
        "Irányítószám": zip_code,
    }

    new_value = value
    for old, new in replacements.items():
        if old in new_value:
            new_value = new_value.replace(old, new)

    lower = new_value.casefold()
    if "gipsz" in lower and "jakab" in lower:
        new_value = recipient.name
    return new_value


def fill_envelope_sheet(ws, recipient: Recipient) -> None:
    zip_code, city, street = split_hungarian_address(recipient.address)

    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str):
                lower = cell.value.casefold()
                if "gipsz" in lower and "jakab" in lower:
                    start_row = cell.row
                    col = cell.column
                    ws.cell(start_row, col).value = recipient.name
                    ws.cell(start_row + 1, col).value = city
                    ws.cell(start_row + 2, col).value = street
                    ws.cell(start_row + 3, col).value = zip_code
                    return

    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str):
                original = cell.value
                new_value = replace_cell_text(original, recipient)
                if new_value != original:
                    cell.value = new_value


def generate_envelopes_xlsx_bytes(
    envelope_template_bytes: bytes,
    recipients: Sequence[Recipient],
) -> bytes:
    try:
        from openpyxl import load_workbook
    except ImportError as exc:
        raise RuntimeError("Az openpyxl könyvtár hiányzik.") from exc

    wb = load_workbook(io.BytesIO(envelope_template_bytes))
    if not wb.worksheets:
        raise RuntimeError("A boríték sablon nem tartalmaz munkalapot.")

    template_ws = wb.worksheets[0]
    for extra in list(wb.worksheets[1:]):
        wb.remove(extra)

    sheets = [template_ws]
    for _ in recipients[1:]:
        ws = wb.copy_worksheet(template_ws)
        ws.page_margins = copy.copy(template_ws.page_margins)
        ws.page_setup = copy.copy(template_ws.page_setup)
        ws.print_options = copy.copy(template_ws.print_options)
        ws.sheet_properties.pageSetUpPr = copy.copy(template_ws.sheet_properties.pageSetUpPr)
        sheets.append(ws)

    for idx, (ws, recipient) in enumerate(zip(sheets, recipients), 1):
        ws.title = title_for_sheet(recipient.name, idx)
        fill_envelope_sheet(ws, recipient)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Webes belépési pontok (JS-ből hívásra)
# ---------------------------------------------------------------------------

def _coerce_to_python(obj):
    """Pyodide JsProxy → Python natív struktúra konverzió, ha kell."""
    try:
        to_py = getattr(obj, "to_py", None)
        if callable(to_py):
            return to_py()
    except Exception:
        pass
    return obj


def parse_uploaded_sheets(files_obj):
    """
    Tulajdoni lapok feldolgozása.

    files_obj: [{name: str, data: bytes}, ...]
    Visszatér: {recipients: [...], default_settlement: str, log: [...]}
    """
    files = _coerce_to_python(files_obj) or []

    all_recipients: List[Recipient] = []
    settlements: List[str] = []
    log: List[str] = []

    for entry in files:
        entry = _coerce_to_python(entry)
        name = entry.get("name", "")
        data = entry.get("data")
        if isinstance(data, memoryview):
            data = bytes(data)
        elif not isinstance(data, (bytes, bytearray)):
            data = bytes(data)
        log.append(f"Feldolgozás: {name}")

        try:
            text = read_property_sheet_bytes(bytes(data), name)
        except Exception as exc:
            log.append(f"  Hiba: {exc}")
            continue

        sheet = parse_property_sheet(text, source_file=name)
        all_recipients.extend(sheet.recipients)
        if sheet.settlement:
            settlements.append(sheet.settlement)

        details = [f"kinyert címzettek: {len(sheet.recipients)}"]
        if sheet.settlement:
            details.append(f"település: {sheet.settlement}")
        if sheet.hrsz:
            details.append(f"hrsz: {sheet.hrsz}")
        log.append("  " + ", ".join(details))

    recipients = deduplicate_recipients(all_recipients)
    default_settlement = ""
    if settlements:
        default_settlement = max(set(settlements), key=settlements.count)

    return {
        "recipients": [r.to_dict() for r in recipients],
        "default_settlement": default_settlement,
        "log": log,
    }


def inspect_template_placeholders(template_bytes):
    """RTF sablon ismeretlen placeholdereinek listázása."""
    data = _coerce_to_python(template_bytes)
    if not isinstance(data, (bytes, bytearray)):
        data = bytes(data)
    rtf, codepage = read_rtf_bytes(bytes(data))
    return {
        "placeholders": find_rtf_placeholders(rtf, codepage=codepage),
        "codepage": codepage,
    }


# A címzett-szintű placeholderek, amelyeket nem kell külön bekérni.
KNOWN_RECIPIENT_PLACEHOLDERS = {
    "tulajdonos_neve",
    "tulajdonos_cime",
    "tulajdonos_címe",
    "cimzett_neve",
    "címzett_neve",
    "cimzett_cime",
    "címzett_cime",
    "cimzett_címe",
    "címzett_címe",
}

# Az alap kérdések placeholderei (UI form fields).
BASE_PLACEHOLDERS = {
    "kituzendo_hrsz",
    "kituzes_datuma",
    "ora_perc",
    "keltezes",
    "kozseg",
}


def list_extra_template_fields(template_bytes):
    """Mely placeholderek vannak a sablonban, amelyek nincsenek az alap kérdések között."""
    data = _coerce_to_python(template_bytes)
    if not isinstance(data, (bytes, bytearray)):
        data = bytes(data)
    rtf, codepage = read_rtf_bytes(bytes(data))
    names = find_rtf_placeholders(rtf, codepage=codepage)
    aliases = build_placeholder_aliases({k: "" for k in BASE_PLACEHOLDERS})
    known = set(aliases.keys()) | KNOWN_RECIPIENT_PLACEHOLDERS | BASE_PLACEHOLDERS
    extras = [name for name in names if name not in known]
    return {
        "extras": extras,
        "codepage": codepage,
    }


def generate_outputs(payload_obj):
    """
    Teljes generálás.

    payload_obj:
        {
          template_bytes: bytes (RTF),
          envelope_bytes: bytes | None (XLSX),
          recipients: [{name, address, role, source_file, settlement}, ...],
          global_values: {kituzendo_hrsz, kituzes_datuma, ora_perc, keltezes, kozseg, ...extras},
          postal: bool,
          make_envelope: bool,
        }
    Visszatér: {rtf_bytes: bytes, rtf_filename: str, xlsx_bytes: bytes|None, xlsx_filename: str|None, warnings: [...]}
    """
    payload = _coerce_to_python(payload_obj) or {}

    template_bytes = payload.get("template_bytes")
    if not isinstance(template_bytes, (bytes, bytearray)):
        template_bytes = bytes(template_bytes)
    envelope_bytes = payload.get("envelope_bytes")
    if envelope_bytes is not None and not isinstance(envelope_bytes, (bytes, bytearray)):
        envelope_bytes = bytes(envelope_bytes)

    raw_recipients = _coerce_to_python(payload.get("recipients")) or []
    recipients: List[Recipient] = []
    for r in raw_recipients:
        r = _coerce_to_python(r)
        recipients.append(
            Recipient(
                name=str(r.get("name", "")).strip(),
                address=str(r.get("address", "")).strip(),
                role=str(r.get("role", "tulajdonos")).strip() or "tulajdonos",
                source_file=str(r.get("source_file", "")),
                settlement=str(r.get("settlement", "")).strip(),
            )
        )

    if not recipients:
        raise RuntimeError("Nincs címzett a generáláshoz.")

    for idx, recipient in enumerate(recipients, 1):
        if not recipient.name or not recipient.address:
            raise RuntimeError(f"A(z) {idx}. címzettnél hiányzik a név vagy a cím.")

    global_values = _coerce_to_python(payload.get("global_values")) or {}
    global_values = {str(k): str(v) for k, v in global_values.items()}

    for required in ("kituzendo_hrsz", "kituzes_datuma", "ora_perc", "kozseg"):
        if not global_values.get(required, "").strip():
            raise RuntimeError(f"Hiányzó adat: {required}")

    if not global_values.get("keltezes", "").strip():
        global_values["keltezes"] = today_hu()

    for recipient in recipients:
        if not recipient.settlement:
            recipient.settlement = global_values.get("kozseg", "")

    postal = bool(payload.get("postal", False))
    make_envelope = bool(payload.get("make_envelope", True))

    template_rtf, codepage = read_rtf_bytes(bytes(template_bytes))

    warnings: List[str] = []

    final_rtf = build_letters_rtf(
        template_rtf=template_rtf,
        codepage=codepage,
        recipients=recipients,
        global_values=global_values,
        postal=postal,
    )

    if not validate_rtf_braces(final_rtf):
        warnings.append("Figyelem: az elkészült RTF kapcsoszárójel-egyensúlya hibásnak tűnik.")

    stamp = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    rtf_bytes = rtf_to_bytes(final_rtf, codepage)

    xlsx_bytes = None
    xlsx_filename = None
    if postal and make_envelope and envelope_bytes:
        xlsx_bytes = generate_envelopes_xlsx_bytes(bytes(envelope_bytes), recipients)
        xlsx_filename = f"boritekok_{stamp}.xlsx"
    elif postal and make_envelope and not envelope_bytes:
        warnings.append("Nincs boríték sablon, ezért XLSX nem készült.")

    return {
        "rtf_bytes": rtf_bytes,
        "rtf_filename": f"kiertesitesek_{stamp}.rtf",
        "xlsx_bytes": xlsx_bytes,
        "xlsx_filename": xlsx_filename,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Feltöltött sablonból (RTF vagy DOCX) levél generálás
# ---------------------------------------------------------------------------

ONLY_PERSONAL_START = "[[csak_szemelyes]]"
ONLY_PERSONAL_END = "[[/csak_szemelyes]]"


def _remove_marker_only_rtf(rtf_text: str, codepage: str, marker_text: str) -> str:
    """Egy adott szöveges markert eltávolít a látható szövegből — tartalmat nem érint."""
    compact_marker, _ = compact_plain_with_map(marker_text)
    if not compact_marker:
        return rtf_text

    while True:
        items = rtf_text_map(rtf_text, codepage=codepage)
        if not items:
            break
        plain = "".join(item.char for item in items)
        compact_plain, compact_to_plain = compact_plain_with_map(plain)
        idx = compact_plain.find(compact_marker)
        if idx == -1:
            break
        start_plain = compact_to_plain[idx]
        end_plain = compact_to_plain[idx + len(compact_marker) - 1] + 1
        raw_start = items[start_plain].start
        raw_end = items[end_plain - 1].end
        rtf_text = rtf_text[:raw_start] + rtf_text[raw_end:]
    return rtf_text


def _strip_binary_destinations(rtf_text: str) -> str:
    """Bináris/non-displayed RTF destination group-ok eltávolítása.

    Az olyan group-okat, mint a beágyazott objektumok (\\object, \\objdata),
    képek (\\pict) vagy bináris adatok (\\bin), a preview-hoz nem szabad
    szövegként kezelni, mert hex dump-ot adnak ki. Itt teljesen kivesszük
    ezeket az RTF-ből, hogy a látható szöveg tiszta legyen.
    """
    # Csak a destination-ok neve — a `\` és az opcionális `\*` előtag
    # a regex-be kerül.
    destinations = (
        # Header-ben szereplő destinations (gyakran \*-os, pl. {\*\stylesheet)
        "fonttbl",
        "colortbl",
        "stylesheet",
        "listtable",
        "listoverridetable",
        "rsidtbl",
        "generator",
        "info",
        "latentstyles",
        "themedata",
        "colorschememapping",
        "datastore",
        "filetbl",
        "xmlnstbl",
        "protlevel",
        "wgrffmtfilter",
        "mmathPr",
        # Binary/encoded tartalmak
        "objdata",
        "objalias",
        "objclass",
        "datafield",
        "object",
        "pict",
        "bin",
        "result",
    )

    for dest in destinations:
        # Opcionálisan elfogadja a {\*\xxx és a {\xxx formákat is
        pattern = re.compile(
            r"\{\s*(?:\\\*\s*)?\\" + dest + r"\b",
            re.IGNORECASE,
        )
        while True:
            m = pattern.search(rtf_text)
            if not m:
                break
            depth = 1
            i = m.end()
            n = len(rtf_text)
            while i < n and depth > 0:
                ch = rtf_text[i]
                if ch == "\\" and i + 1 < n:
                    i += 2
                    continue
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                i += 1
            rtf_text = rtf_text[:m.start()] + rtf_text[i:]
    return rtf_text


def _apply_personal_markers_rtf(rtf_text: str, codepage: str, postal: bool) -> str:
    """A [[csak_szemelyes]]...[[/csak_szemelyes]] blokk kezelése a feltöltött RTF-ben."""
    if postal:
        rtf_text = remove_visible_span_by_compact_text(
            rtf_text,
            start_text=ONLY_PERSONAL_START,
            end_text=ONLY_PERSONAL_END,
            codepage=codepage,
            extend_to_paragraph=True,
        )
        # Ha valamilyen okból maradtak markerek, töröljük őket
        rtf_text = _remove_marker_only_rtf(rtf_text, codepage, ONLY_PERSONAL_START)
        rtf_text = _remove_marker_only_rtf(rtf_text, codepage, ONLY_PERSONAL_END)
    else:
        rtf_text = _remove_marker_only_rtf(rtf_text, codepage, ONLY_PERSONAL_START)
        rtf_text = _remove_marker_only_rtf(rtf_text, codepage, ONLY_PERSONAL_END)
    return rtf_text


def _replace_in_docx_paragraph(p_elem, aliases: Dict[str, str]) -> None:
    """Paragrafus szövegében cseréli a [[placeholder]]-eket. A formázás
    egy paragrafuson belül egységessé válik (egy w:t-be kerül a teljes szöveg)."""
    from docx.oxml.ns import qn

    text_nodes = p_elem.findall(".//" + qn("w:t"))
    if not text_nodes:
        return
    full_text = "".join(t.text or "" for t in text_nodes)

    def replace_fn(match: "re.Match") -> str:
        name = normalize_placeholder_name(match.group(1))
        value = aliases.get(name)
        if value is None:
            return match.group(0)
        return value

    new_text = PLACEHOLDER_RE.sub(replace_fn, full_text)
    new_text = STAR_PLACEHOLDER_RE.sub(replace_fn, new_text)

    if new_text != full_text:
        text_nodes[0].text = new_text
        text_nodes[0].set(qn("xml:space"), "preserve")
        for t in text_nodes[1:]:
            t.text = ""


def _paragraph_text(p_elem) -> str:
    from docx.oxml.ns import qn

    text_nodes = p_elem.findall(".//" + qn("w:t"))
    return "".join(t.text or "" for t in text_nodes)


def _strip_text_from_paragraph(p_elem, fragment: str) -> None:
    """Egy adott szöveges fragmentumot eltávolít a paragrafusból (akár több w:t-ből összerakva)."""
    from docx.oxml.ns import qn

    if not fragment:
        return
    text_nodes = p_elem.findall(".//" + qn("w:t"))
    if not text_nodes:
        return
    full_text = "".join(t.text or "" for t in text_nodes)
    new_text = full_text.replace(fragment, "")
    if new_text != full_text:
        text_nodes[0].text = new_text
        text_nodes[0].set(qn("xml:space"), "preserve")
        for t in text_nodes[1:]:
            t.text = ""


def _process_docx_personal_markers(body_elems, postal: bool):
    """A [[csak_szemelyes]]...[[/csak_szemelyes]] kezelés DOCX paragrafus szinten."""
    from docx.oxml.ns import qn

    out = []
    in_block = False
    for elem in body_elems:
        if elem.tag == qn("w:p"):
            text = _paragraph_text(elem)
            has_start = ONLY_PERSONAL_START in text
            has_end = ONLY_PERSONAL_END in text

            if postal:
                if has_start and has_end:
                    # Egy paragrafusban van mindkettő — egész paragrafust dobjuk
                    continue
                if has_start:
                    in_block = True
                    continue
                if has_end:
                    in_block = False
                    continue
                if in_block:
                    continue
                out.append(elem)
            else:
                if has_start:
                    _strip_text_from_paragraph(elem, ONLY_PERSONAL_START)
                if has_end:
                    _strip_text_from_paragraph(elem, ONLY_PERSONAL_END)
                out.append(elem)
        else:
            if postal and in_block:
                continue
            out.append(elem)
    return out


def _generate_letters_from_rtf(template_bytes: bytes, recipients, global_values, postal: bool):
    template_rtf, codepage = read_rtf_bytes(template_bytes)
    template_rtf = _apply_personal_markers_rtf(template_rtf, codepage, postal)

    final_rtf = build_letters_rtf(
        template_rtf=template_rtf,
        codepage=codepage,
        recipients=recipients,
        global_values=global_values,
        postal=False,  # a marker-blokkot már külön kezeltük
    )
    warnings: List[str] = []
    if not validate_rtf_braces(final_rtf):
        warnings.append("Figyelem: az elkészült RTF kapcsoszárójel-egyensúlya hibásnak tűnik.")

    stamp = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    return {
        "letter_bytes": rtf_to_bytes(final_rtf, codepage),
        "letter_filename": f"kiertesitesek_{stamp}.rtf",
        "letter_mime": "application/rtf",
        "warnings": warnings,
    }


def _generate_letters_from_docx(template_bytes: bytes, recipients, global_values, postal: bool):
    try:
        from docx import Document
        from docx.oxml.ns import qn
        from docx.oxml import OxmlElement
    except ImportError as exc:
        raise RuntimeError("A python-docx könyvtár hiányzik a Pyodide környezetből.") from exc

    from copy import deepcopy

    src_doc = Document(io.BytesIO(template_bytes))
    body = src_doc.element.body

    sectPr = body.find(qn("w:sectPr"))
    template_elems = [c for c in list(body) if c.tag != qn("w:sectPr")]

    # Body kiürítése (sectPr marad)
    for c in list(body):
        if c.tag != qn("w:sectPr"):
            body.remove(c)

    for i, recipient in enumerate(recipients):
        values = dict(global_values)
        values.update(
            {
                "tulajdonos_neve": recipient.name,
                "tulajdonos_cime": recipient.address,
                "kozseg": recipient.settlement or global_values.get("kozseg", ""),
                "cimzett_neve": recipient.name,
                "cimzett_cime": recipient.address,
            }
        )
        aliases = build_placeholder_aliases(values)

        cloned = [deepcopy(e) for e in template_elems]
        cloned = _process_docx_personal_markers(cloned, postal)

        for elem in cloned:
            for p in elem.iter(qn("w:p")):
                _replace_in_docx_paragraph(p, aliases)

        # Beillesztés a body-be (sectPr elé)
        for elem in cloned:
            if sectPr is not None:
                body.insert(list(body).index(sectPr), elem)
            else:
                body.append(elem)

        # Page break a következő címzett előtt
        if i < len(recipients) - 1:
            page_p = OxmlElement("w:p")
            page_r = OxmlElement("w:r")
            page_br = OxmlElement("w:br")
            page_br.set(qn("w:type"), "page")
            page_r.append(page_br)
            page_p.append(page_r)
            if sectPr is not None:
                body.insert(list(body).index(sectPr), page_p)
            else:
                body.append(page_p)

    output = io.BytesIO()
    src_doc.save(output)
    stamp = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    return {
        "letter_bytes": output.getvalue(),
        "letter_filename": f"kiertesitesek_{stamp}.docx",
        "letter_mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "warnings": [],
    }


def list_template_placeholders(payload_obj):
    """Megnézi mi placeholdereket tartalmaz egy feltöltött RTF/DOCX sablon.

    payload: { template_bytes: bytes, template_filename: str }
    """
    payload = _coerce_to_python(payload_obj) or {}
    data = payload.get("template_bytes")
    filename = str(payload.get("template_filename", ""))
    if not isinstance(data, (bytes, bytearray)):
        data = bytes(data)
    lower = (filename or "").lower()
    if lower.endswith(".rtf"):
        rtf, cp = read_rtf_bytes(bytes(data))
        names = find_rtf_placeholders(rtf, codepage=cp)
        return {"kind": "rtf", "placeholders": names}
    if lower.endswith(".docx"):
        try:
            from docx import Document
        except ImportError as exc:
            raise RuntimeError("A python-docx könyvtár hiányzik.") from exc
        doc = Document(io.BytesIO(bytes(data)))
        text = "\n".join(p.text for p in doc.paragraphs)
        names: List[str] = []
        for rex in (PLACEHOLDER_RE, STAR_PLACEHOLDER_RE):
            for m in rex.finditer(text):
                n = normalize_placeholder_name(m.group(1))
                if n and n not in names:
                    names.append(n)
        return {"kind": "docx", "placeholders": names}
    if lower.endswith(".doc"):
        raise RuntimeError(
            "A bináris .doc formátum nem támogatott. A Word-ben mentsd 'RTF' vagy 'Word dokumentum (.docx)' formában."
        )
    raise RuntimeError(f"Nem támogatott fájltípus: {filename}")


def generate_outputs_from_uploaded_template(payload_obj):
    """
    Levél-generálás feltöltött RTF vagy DOCX sablonnal.

    payload:
      template_bytes: bytes
      template_filename: str  ('.rtf' vagy '.docx' kiterjesztés alapján döntünk)
      envelope_bytes: bytes | None
      recipients: [...]
      global_values: {...}
      postal: bool
      make_envelope: bool
    """
    payload = _coerce_to_python(payload_obj) or {}
    template_bytes = payload.get("template_bytes")
    if not isinstance(template_bytes, (bytes, bytearray)):
        template_bytes = bytes(template_bytes)
    template_bytes = bytes(template_bytes)
    filename = str(payload.get("template_filename", ""))
    envelope_bytes = payload.get("envelope_bytes")
    if envelope_bytes is not None and not isinstance(envelope_bytes, (bytes, bytearray)):
        envelope_bytes = bytes(envelope_bytes)

    raw_recipients = _coerce_to_python(payload.get("recipients")) or []
    recipients: List[Recipient] = []
    for r in raw_recipients:
        r = _coerce_to_python(r)
        recipients.append(
            Recipient(
                name=str(r.get("name", "")).strip(),
                address=str(r.get("address", "")).strip(),
                role=str(r.get("role", "tulajdonos")).strip() or "tulajdonos",
                source_file=str(r.get("source_file", "")),
                settlement=str(r.get("settlement", "")).strip(),
            )
        )

    if not recipients:
        raise RuntimeError("Nincs címzett a generáláshoz.")

    for idx, recipient in enumerate(recipients, 1):
        if not recipient.name or not recipient.address:
            raise RuntimeError(f"A(z) {idx}. címzettnél hiányzik a név vagy a cím.")

    global_values = _coerce_to_python(payload.get("global_values")) or {}
    global_values = {str(k): str(v) for k, v in global_values.items()}

    if not global_values.get("keltezes", "").strip():
        global_values["keltezes"] = today_hu()

    for recipient in recipients:
        if not recipient.settlement:
            recipient.settlement = global_values.get("kozseg", "")

    postal = bool(payload.get("postal", False))
    make_envelope = bool(payload.get("make_envelope", True))

    lower = filename.lower()
    if lower.endswith(".rtf"):
        result = _generate_letters_from_rtf(template_bytes, recipients, global_values, postal)
    elif lower.endswith(".docx"):
        result = _generate_letters_from_docx(template_bytes, recipients, global_values, postal)
    elif lower.endswith(".doc"):
        raise RuntimeError(
            "A bináris .doc formátum nem támogatott. A Word-ben mentsd 'RTF' vagy 'Word dokumentum (.docx)' formában."
        )
    else:
        raise RuntimeError(f"Nem támogatott sablon fájltípus: {filename}")

    xlsx_bytes = None
    xlsx_filename = None
    warnings = list(result.get("warnings", []))

    if postal and make_envelope and envelope_bytes:
        xlsx_bytes = generate_envelopes_xlsx_bytes(bytes(envelope_bytes), recipients)
        stamp = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        xlsx_filename = f"boritekok_{stamp}.xlsx"
    elif postal and make_envelope and not envelope_bytes:
        warnings.append("Nincs boríték sablon, ezért XLSX nem készült.")

    return {
        "letter_bytes": result["letter_bytes"],
        "letter_filename": result["letter_filename"],
        "letter_mime": result["letter_mime"],
        "xlsx_bytes": xlsx_bytes,
        "xlsx_filename": xlsx_filename,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Előnézet — egyszerű szöveges előnézet az első címzetthez
# ---------------------------------------------------------------------------

def preview_first_letter(payload_obj):
    """Egyszerű szöveges előnézet az első címzetthez.

    payload:
      template_bytes: bytes (alap RTF vagy feltöltött RTF/DOCX)
      template_filename: str  (üres = alap kiertesites4.rtf)
      recipient: { name, address, role, settlement }
      global_values: {...}
      postal: bool
    """
    payload = _coerce_to_python(payload_obj) or {}
    template_bytes = payload.get("template_bytes")
    if not isinstance(template_bytes, (bytes, bytearray)):
        template_bytes = bytes(template_bytes)
    template_bytes = bytes(template_bytes)
    filename = str(payload.get("template_filename", "")).lower()

    raw_recipient = _coerce_to_python(payload.get("recipient")) or {}
    recipient = Recipient(
        name=str(raw_recipient.get("name", "")).strip(),
        address=str(raw_recipient.get("address", "")).strip(),
        role=str(raw_recipient.get("role", "tulajdonos")).strip() or "tulajdonos",
        source_file="",
        settlement=str(raw_recipient.get("settlement", "")).strip(),
    )

    global_values = _coerce_to_python(payload.get("global_values")) or {}
    global_values = {str(k): str(v) for k, v in global_values.items()}
    if not global_values.get("keltezes", "").strip():
        global_values["keltezes"] = today_hu()
    if not recipient.settlement:
        recipient.settlement = global_values.get("kozseg", "")

    postal = bool(payload.get("postal", False))

    values = dict(global_values)
    values.update(
        {
            "tulajdonos_neve": recipient.name,
            "tulajdonos_cime": recipient.address,
            "kozseg": recipient.settlement or global_values.get("kozseg", ""),
            "cimzett_neve": recipient.name,
            "cimzett_cime": recipient.address,
        }
    )
    aliases = build_placeholder_aliases(values)

    is_docx = filename.endswith(".docx")
    is_custom_rtf = filename.endswith(".rtf")

    if is_docx:
        try:
            from docx import Document
        except ImportError:
            return {"text": "[A python-docx könyvtár nem érhető el az előnézethez.]"}
        doc = Document(io.BytesIO(template_bytes))
        lines: List[str] = []
        in_block = False
        for p in doc.paragraphs:
            text = p.text
            has_start = ONLY_PERSONAL_START in text
            has_end = ONLY_PERSONAL_END in text
            if postal:
                if has_start and has_end:
                    continue
                if has_start:
                    in_block = True
                    continue
                if has_end:
                    in_block = False
                    continue
                if in_block:
                    continue
                lines.append(text)
            else:
                text = text.replace(ONLY_PERSONAL_START, "").replace(ONLY_PERSONAL_END, "")
                lines.append(text)
        full_text = "\n".join(lines)
    else:
        rtf, cp = read_rtf_bytes(template_bytes)
        if is_custom_rtf:
            rtf = _apply_personal_markers_rtf(rtf, cp, postal)
        else:
            # Alap kiertesites4.rtf — eredeti viselkedés
            if postal:
                rtf = remove_acknowledgement_block(rtf, codepage=cp)
        rtf = _strip_binary_destinations(rtf)
        try:
            _prefix, body, _suffix = split_rtf_document(rtf)
        except Exception:
            body = rtf
        items = rtf_text_map(body, codepage=cp)
        full_text = "".join(item.char for item in items)

    def replace_fn(match):
        name = normalize_placeholder_name(match.group(1))
        value = aliases.get(name)
        return value if value is not None else match.group(0)

    full_text = PLACEHOLDER_RE.sub(replace_fn, full_text)
    full_text = STAR_PLACEHOLDER_RE.sub(replace_fn, full_text)

    # Tisztítás: a túl sok üres sort kettőre csökkentjük
    full_text = re.sub(r"\n{3,}", "\n\n", full_text)
    full_text = full_text.strip("\n")
    return {"text": full_text}
