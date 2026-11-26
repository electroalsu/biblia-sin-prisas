"""Import pinned source snapshots. See README for inputs and provenance."""
import json
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as XML

ROOT = Path(__file__).resolve().parents[1]
INPUT = Path(sys.argv[1])
BOOKS = re.search(r"bookIds = '([^']+)'", (ROOT / 'src/books.ts').read_text())[1].split()
OSIS = 'Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev'.split()
OSIS_BOOKS = dict(zip(OSIS, BOOKS))


def add(books, book, chapter, verse, text):
    clean = ' '.join(text.split())
    if clean:
        verses = books.setdefault(book, {}).setdefault(int(chapter), {})
        if verse in verses:
            raise ValueError(f'Duplicate verse {book} {chapter}:{verse}')
        verses[verse] = clean


def usfx(filename):
    books = {}
    for book in XML.parse(INPUT / filename).getroot().findall('book'):
        code = book.attrib['id']
        if code not in BOOKS:
            continue
        chapter, verse, parts = 0, None, []

        def visit(node):
            nonlocal chapter, verse, parts
            if node.tag in {'f', 'x', 'd', 'vp', 's', 'toc', 'id', 'h'}:
                return
            if node.tag == 'c':
                chapter = node.attrib['id']
            if node.tag == 'v':
                verse, parts = node.attrib['id'], []
            if node.tag == 've' and verse is not None:
                add(books, code, chapter, verse, ''.join(parts))
                verse = None
            if verse and node.text:
                parts.append(node.text)
            for child in node:
                visit(child)
                if verse and child.tail:
                    parts.append(child.tail)
        visit(book)
    return books


def osis(filename):
    books = {}
    namespace = '{http://www.bibletechnologies.net/2003/OSIS/namespace}'
    for node in XML.parse(INPUT / filename).iter(namespace + 'verse'):
        book, chapter, verse = node.attrib['osisID'].split('.')
        if book in OSIS_BOOKS:
            add(books, OSIS_BOOKS[book], chapter, verse, ''.join(node.itertext()))
    return books


def getbible(filename):
    books = {}
    for line in (INPUT / filename).read_text(encoding='utf-8-sig').splitlines():
        if not line.strip():
            continue
        book, chapter, verse, text = line.split('||', 3)
        add(books, BOOKS[int(book[:-1]) - 1], chapter, verse, text)
    return books


def vpl(filename):
    books = {}
    aliases = dict(zip('1JO 2JO 3JO EZE JAM JOH JOE MAR NAH PHI SOL'.split(),
                       '1JN 2JN 3JN EZK JAS JHN JOL MRK NAM PHP SNG'.split()))
    for line in (INPUT / filename).read_text(encoding='utf-8-sig').splitlines():
        match = re.fullmatch(r'(\w+) (\d+):([\w–-]+) (.+)', line)
        if match:
            book, chapter, verse, text = match.groups()
            book = aliases.get(book, book)
            if book in BOOKS:
                add(books, book, chapter, verse, text)
    return books


def alignments(filename, canonical, edition):
    """Read explicit CrossWire mappings. Only pair complete one-to-one verses."""
    maps, blocked = {}, set()

    def endpoints(spec):
        return [re.fullmatch(r'(\w+)\.(\d+)\.(\d+)(!\w+)?', s) for s in spec.split('-')]

    def span(groups, corpus):
        book = OSIS_BOOKS.get(groups[0][1])
        if not book or any(OSIS_BOOKS.get(g[1]) != book for g in groups):
            return []
        first, last = (int(groups[0][2]), int(groups[0][3])), (int(groups[-1][2]), int(groups[-1][3]))
        return [(book, c, str(v)) for c in range(first[0], last[0] + 1)
                for v in sorted(int(v) for v in corpus.get(book, {}).get(c, {}) if v.isdecimal())
                if first <= (c, v) <= last]

    for line in (ROOT / 'public/scripture/attribution/crosswire' / filename).read_text().splitlines():
        if '=' not in line or line.strip().startswith('#'):
            continue
        left, right = [endpoints(s.strip()) for s in line.split('=', 1)]
        for group in left + right:
            if group and group[1] in OSIS_BOOKS:
                blocked.add((OSIS_BOOKS[group[1]], int(group[2])))
        if not all(left + right):
            continue
        for groups in [left, right]:
            if groups[0][1] in OSIS_BOOKS and groups[0][1] == groups[-1][1]:
                for c in range(int(groups[0][2]), int(groups[-1][2]) + 1):
                    blocked.add((OSIS_BOOKS[groups[0][1]], c))
        if any(g[4] for g in left + right):
            continue
        local, target = span(left, edition), span(right, canonical)
        if len(local) == len(target):
            for src, dest in zip(local, target):
                if src[0] == dest[0]:
                    maps[dest] = src[1:]
    return maps, blocked


def write_json(file, value):
    file.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')


editions = {
    'rv1909': usfx('spa-rv1909.usfx.xml'),
    'web': usfx('eng-web.usfx.xml'),
    'bes': usfx('spa-bes.usfx.xml'),
    'vbl': usfx('spa-vbl.usfx.xml'),
    'luther': osis('deu-luther1912.osis.xml'),
    'synodal': getbible('synodal.txt'),
    'martin': getbible('martin.txt'),
    'blivre': vpl('bliv-n4_vpl.txt'),
    'bsb': usfx('eng-bsb.usfx.xml'),
}
canonical = editions['web']
rules = {key: alignments(file, canonical, editions[key]) for key, file in {
    'luther': 'Luther.properties',
}.items()}
# Where the numbering may be ambiguous, require an explicit mapping.
common_exceptions = {'ACT': {19}, '2CO': {13}, 'PHP': {1}, '3JN': {1}, 'REV': {12, 13}}
old_testament = set(BOOKS[:39])
for key in ('martin', 'luther', 'blivre'):
    maps, blocked = rules.setdefault(key, ({}, set()))
    # Check French/Russian/German OT chapters with known alternate numbering,
    # using source-specific mappings where the CrossWire tables identify them.
    for file in ('NRSV.properties', 'Segond.properties', 'Luther.properties', 'Synodal.properties'):
        _, candidates = alignments(file, canonical, editions[key])
        blocked.update((book, chapter) for book, chapter in candidates if book in old_testament)

# GetBible's Synodal snapshot is already renumbered to KJV. Its native Russian
# references are embedded in the text where they differ, so do not remap it
# with a table meant for source editions that use original Synodal references.
# Philippians has two traditions even when the chapter has identical labels.
# These verse pairs were checked against the actual selected digital texts.
philippians_swapped = {'vbl', 'bsb', 'blivre'}
for key in editions:
    if key == 'web':
        continue
    maps, _ = rules.setdefault(key, ({}, set()))
    if list(editions[key].get('PHP', {}).get(1, {})) == list(canonical['PHP'][1]):
        for v in canonical['PHP'][1]:
            target = {'16': '17', '17': '16'}.get(v, v) if key in philippians_swapped else v
            maps['PHP', 1, v] = (1, target)

index = {}
for book in BOOKS:
    chapters = canonical[book]
    index[book] = {c: [v for v in verses if v[0].isdigit()] for c, verses in chapters.items()}
    output = {}
    for key, corpus in editions.items():
        native = corpus.get(book, {})
        maps, blocked = rules.get(key, ({}, set()))
        aligned = {}
        for chapter, verses in chapters.items():
            same_numbering = list(native.get(chapter, {})) == list(verses)
            safe_chapter = same_numbering and (book, chapter) not in blocked and chapter not in common_exceptions.get(book, set())
            if key == 'web' or safe_chapter:
                aligned[str(chapter)] = 'same'
                continue
            entries = {v: maps[(book, chapter, v)] for v in verses if (book, chapter, v) in maps}
            if entries:
                aligned[str(chapter)] = entries
        output[key] = {'native': native, 'aligned': aligned}
    write_json(ROOT / 'public/scripture' / f'{book}.json', output)
write_json(ROOT / 'src/structure.json', index)
