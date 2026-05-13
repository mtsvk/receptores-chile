import os, re, json, zipfile, unicodedata, xml.etree.ElementTree as ET
from collections import Counter, defaultdict

BASE='/mnt/data'
OUT=os.path.join(BASE,'receptores_chile_site')
os.makedirs(os.path.join(OUT,'data'), exist_ok=True)
os.makedirs(os.path.join(OUT,'assets'), exist_ok=True)

# ---------- Normalization ----------
def normalize_text(s: str) -> str:
    s = '' if s is None else str(s)
    s = s.strip().lower()
    # preserve ñ while removing diacritics
    s = s.replace('ñ', '__enie__').replace('Ñ', '__enie__')
    s = unicodedata.normalize('NFD', s)
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    s = s.replace('__enie__', 'ñ')
    s = s.replace('°', ' ')
    s = re.sub(r'[^a-z0-9ñ]+', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def slugify(s):
    return re.sub(r'[^a-z0-9]+','-', normalize_text(s).replace('ñ','n')).strip('-')

REGION_CANON = {
    'arica y parinacota': 'Arica y Parinacota',
    'tarapaca': 'Tarapacá',
    'antofagasta': 'Antofagasta',
    'atacama': 'Atacama',
    'coquimbo': 'Coquimbo',
    'valparaiso': 'Valparaíso',
    'lib gral bernardo o higgins': "Libertador General Bernardo O'Higgins",
    'libertador general bernardo o higgins': "Libertador General Bernardo O'Higgins",
    'maule': 'Maule',
    'ñuble': 'Ñuble',
    'nuble': 'Ñuble',
    'biobio': 'Biobío',
    'bio bio': 'Biobío',
    'la araucania': 'La Araucanía',
    'los rios': 'Los Ríos',
    'los lagos': 'Los Lagos',
    'aisen del general carlos ibañez del campo': 'Aysén del General Carlos Ibáñez del Campo',
    'aysen del general carlos ibañez del campo': 'Aysén del General Carlos Ibáñez del Campo',
    'magallanes y la antartica chilena': 'Magallanes y de la Antártica Chilena',
    'metropolitana de santiago': 'Metropolitana de Santiago',
    'region metropolitana de santiago': 'Metropolitana de Santiago',
}

COURT_CLEAN = {
    'CORTE DE APELACIONES DE VALPARAISO': 'Corte de Apelaciones de Valparaíso',
    'CORTE DE APELACIONES DE CONCEPCION': 'Corte de Apelaciones de Concepción',
    'CORTE DE APELACIONES DE COPIAPO': 'Corte de Apelaciones de Copiapó',
    'CORTE DE APELACIONES DE COIHAIQUE': 'Corte de Apelaciones de Coihaique',
    'CORTE DE APELACIONES DE CHILLAN': 'Corte de Apelaciones de Chillán',
    'CORTE DE APELACIONES DE LA SERENA': 'Corte de Apelaciones de La Serena',
    'CORTE DE APELACIONES DE PUERTO MONTT': 'Corte de Apelaciones de Puerto Montt',
    'CORTE DE APELACIONES DE PUNTA ARENAS': 'Corte de Apelaciones de Punta Arenas',
    'CORTE DE APELACIONES DE SAN MIGUEL': 'Corte de Apelaciones de San Miguel',
    'CORTE DE APELACIONES DE SANTIAGO': 'Corte de Apelaciones de Santiago',
    'CORTE DE APELACIONES DE TALCA': 'Corte de Apelaciones de Talca',
    'CORTE DE APELACIONES DE TEMUCO': 'Corte de Apelaciones de Temuco',
    'CORTE DE APELACIONES DE VALDIVIA': 'Corte de Apelaciones de Valdivia',
    'CORTE DE APELACIONES DE RANCAGUA': 'Corte de Apelaciones de Rancagua',
    'CORTE DE APELACIONES DE ANTOFAGASTA': 'Corte de Apelaciones de Antofagasta',
    'CORTE DE APELACIONES DE ARICA': 'Corte de Apelaciones de Arica',
    'CORTE DE APELACIONES DE IQUIQUE': 'Corte de Apelaciones de Iquique',
}

def title_keep(s):
    if not s: return ''
    small = {'de','del','la','las','los','y','en','lo','el'}
    parts = re.split(r'(\s+)', s.strip().lower())
    out=[]
    for p in parts:
        if p.isspace(): out.append(p); continue
        if p in small: out.append(p)
        else: out.append(p[:1].upper()+p[1:])
    return ''.join(out).replace('Ii','II').replace('Iii','III')

# ---------- XLSX XML parser (no spreadsheet library) ----------
def col_to_idx(cell_ref):
    m = re.match(r'([A-Z]+)', cell_ref)
    n = 0
    for ch in m.group(1):
        n = n * 26 + ord(ch) - 64
    return n - 1

def parse_xlsx_basic(path):
    ns={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    rows=[]
    for row in root.findall('.//x:sheetData/x:row', ns):
        vals={}
        for c in row.findall('x:c', ns):
            idx=col_to_idx(c.attrib['r'])
            t=c.attrib.get('t')
            if t=='inlineStr':
                isel=c.find('x:is', ns)
                text=''.join(tn.text or '' for tn in isel.findall('.//x:t', ns)) if isel is not None else ''
            else:
                v=c.find('x:v', ns)
                text=v.text if v is not None else ''
            vals[idx]=str(text).strip()
        if vals:
            rows.append([vals.get(i,'') for i in range(7)])
    return rows[1], rows[2:]

# ---------- Comunas parser ----------
def extract_link_label(cell):
    # wiki links: [[Page|Label]] or [[Label]]; returns first bold link label
    m = re.search(r"'''\[\[([^\]|]+)(?:\|([^\]]+))?\]\]'''", cell)
    if not m:
        m = re.search(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]', cell)
    if not m:
        return re.sub(r'<[^>]+>','',cell).strip("' ")
    return (m.group(2) or m.group(1)).strip()

def dms_to_decimal(s):
    if not s: return None
    s = s.strip().replace('−','-')
    sign = -1 if s.startswith('-') else 1
    nums = re.findall(r'\d+(?:\.\d+)?', s)
    if not nums: return None
    deg=float(nums[0]); minute=float(nums[1]) if len(nums)>1 else 0; sec=float(nums[2]) if len(nums)>2 else 0
    return round(sign*(deg + minute/60 + sec/3600), 6)

def parse_comunas(path):
    text = open(path, encoding='utf-8').read()
    # Each comuna row starts with |<code> and ends before the next table row.
    # This is more reliable than splitting on '|-' because some copied wiki rows do not preserve
    # identical newlines around the separator.
    chunks = re.findall(r'(\|<code>\d+</code>.*?)(?=\n\|-\n|\n\|\})', text, flags=re.S)
    comunas=[]
    for ch in chunks:
        mcode = re.search(r'\|<code>(\d+)</code>', ch)
        if not mcode:
            continue
        cut=mcode.group(1)
        cells = re.split(r'\n\|', ch)
        # Extract after code and || in whole chunk
        first_line = re.search(r'\|<code>\d+</code>(?:\|\||\n\|)(.+)', ch)
        nombre = extract_link_label(first_line.group(1)) if first_line else ''
        # Provincia is usually second [[...]] after image line; use line containing Provincia
        links = re.findall(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]', ch)
        # first link is comuna, second often image, third maybe province. Instead region is nombre=...
        prov=''
        # Province appears in line after image, with Provincia
        mp = re.search(r'\|\[\[Provincia[^\]|]*(?:\|([^\]]+))?\]\]', ch)
        if mp:
            prov = (mp.group(1) or '').strip()
        else:
            # any link with Provincia de X|X
            for a,b in links:
                if 'Provincia' in a:
                    prov=(b or a.replace('Provincia de ','').replace('Provincia del ','')).strip()
                    break
        mr = re.search(r'nombre=([^}\n]+)\}\}', ch)
        if mr:
            region = mr.group(1).strip()
        else:
            mb = re.search(r'\{\{[Bb]andera2\|([^}\n|]+)', ch)
            region = mb.group(1).strip() if mb else ''
        region = re.sub(r'^(XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\s+Región\s+de\s+', '', region).strip()
        region = re.sub(r'^(XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\s+Región\s+del\s+', '', region).strip()
        region = REGION_CANON.get(normalize_text(region), region)
        # lat/long are last two pipe lines with degree symbol
        coords = re.findall(r'\|\s*(-?\d+°[^\n\|]+)', ch)
        lat = dms_to_decimal(coords[-2]) if len(coords)>=2 else None
        lng = dms_to_decimal(coords[-1]) if len(coords)>=1 else None
        variantes = sorted(set([nombre, normalize_text(nombre), nombre.replace('á','a').replace('é','e').replace('í','i').replace('ó','o').replace('ú','u')]))
        comunas.append({
            'cut': cut,
            'nombre': nombre,
            'nombre_normalizado': normalize_text(nombre),
            'provincia': prov,
            'region': region,
            'lat': lat,
            'lng': lng,
            'variantes': variantes
        })
    return comunas

# ---------- Court territories from COT Art. 55 plus comunas ----------
def build_cortes(comunas):
    by_region=defaultdict(list); by_prov=defaultdict(list); by_name={}
    for c in comunas:
        by_region[normalize_text(c['region'])].append(c['nombre'])
        by_prov[normalize_text(c['provincia'])].append(c['nombre'])
        by_name[normalize_text(c['nombre'])]=c['nombre']
    def reg(name): return sorted(by_region.get(normalize_text(name), []))
    def prov(name): return sorted(by_prov.get(normalize_text(name), []))
    def names(items):
        return sorted([by_name[normalize_text(x)] for x in items if normalize_text(x) in by_name])
    santiago_excl = names(['Lo Espejo','San Miguel','San Joaquín','La Cisterna','San Ramón','La Granja','El Bosque','La Pintana','Pedro Aguirre Cerda'])
    santiago = sorted(set(prov('Chacabuco') + prov('Santiago')) - set(santiago_excl))
    san_miguel = sorted(set(prov('Cordillera')+prov('Maipo')+prov('Talagante')+prov('Melipilla')+santiago_excl))
    chillan = sorted(set(reg('Ñuble') + names(['Tucapel'])))
    concepcion = sorted(set(prov('Concepción') + prov('Arauco') + prov('Biobío')) - set(names(['Tucapel'])))
    valdivia = sorted(set(reg('Los Ríos') + prov('Osorno')))
    puerto_montt = sorted(set(prov('Llanquihue') + prov('Chiloé') + prov('Palena')))
    territory = {
        'Corte de Apelaciones de Arica': reg('Arica y Parinacota'),
        'Corte de Apelaciones de Iquique': reg('Tarapacá'),
        'Corte de Apelaciones de Antofagasta': reg('Antofagasta'),
        'Corte de Apelaciones de Copiapó': reg('Atacama'),
        'Corte de Apelaciones de La Serena': reg('Coquimbo'),
        'Corte de Apelaciones de Valparaíso': reg('Valparaíso'),
        'Corte de Apelaciones de Santiago': santiago,
        'Corte de Apelaciones de San Miguel': san_miguel,
        'Corte de Apelaciones de Rancagua': reg("Libertador General Bernardo O'Higgins"),
        'Corte de Apelaciones de Talca': reg('Maule'),
        'Corte de Apelaciones de Chillán': chillan,
        'Corte de Apelaciones de Concepción': concepcion,
        'Corte de Apelaciones de Temuco': reg('La Araucanía'),
        'Corte de Apelaciones de Valdivia': valdivia,
        'Corte de Apelaciones de Puerto Montt': puerto_montt,
        'Corte de Apelaciones de Coihaique': reg('Aysén del General Carlos Ibáñez del Campo'),
        'Corte de Apelaciones de Punta Arenas': reg('Magallanes y de la Antártica Chilena'),
    }
    notes={
        'Corte de Apelaciones de Santiago': 'Art. 55 COT: provincias de Chacabuco y Santiago, con exclusiones expresas. Art. 391 COT: regla especial Santiago/San Miguel para receptores.',
        'Corte de Apelaciones de San Miguel': 'Art. 55 COT: provincias de Cordillera, Maipo, Talagante, Melipilla y ciertas comunas de la provincia de Santiago. Art. 391 COT: regla especial Santiago/San Miguel para receptores.',
        'Corte de Apelaciones de Chillán': 'Art. 55 COT: Región de Ñuble y comuna de Tucapel.',
        'Corte de Apelaciones de Concepción': 'Art. 55 COT: provincias de Concepción, Arauco y Biobío, salvo Tucapel.',
        'Corte de Apelaciones de Valdivia': 'Art. 55 COT: Región de Los Ríos y provincia de Osorno.',
        'Corte de Apelaciones de Puerto Montt': 'Art. 55 COT: provincias de Llanquihue, Chiloé y Palena.',
    }
    return [{
        'nombre': k,
        'nombre_normalizado': normalize_text(k),
        'territorio': ', '.join(v[:8]) + ('…' if len(v)>8 else ''),
        'regiones_comunas': v,
        'notas': notes.get(k, 'Territorio jurisdiccional inferido desde Art. 55 COT y comunas/provincias de la fuente territorial.')
    } for k,v in territory.items()]

# ---------- Legal tribunal parsers ----------
def clean_legal_text(text):
    # remove page headers, law marginalia and collapse spaces; keep accents
    text = re.sub(r'Biblioteca del Congreso Nacional.*?(?:\n|$)', ' ', text)
    text = re.sub(r'Codigo ORGÁNICO.*?(?:\n|$)', ' ', text)
    text = re.sub(r'página \d+ de \d+', ' ', text)
    text = re.sub(r'LEY\s+\d+|Ley\s+\d+|D\.O\.\s*\d{2}\.\d{2}\.\d{4}|Art\.\s*[^\n]{0,25}', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def split_comunas_list(s, asiento=None, comunas_by_prov=None):
    s = re.sub(r'\bde la (Primera|Segunda|Tercera|Cuarta|Quinta|Sexta|Séptima|Octava|Novena|Décima|Décimo|Undécima|Duodécima|Decimocuarta|Decimoquinta|Decimosexta).*$', '', s, flags=re.I)
    s = re.sub(r'\bLey\b.*$', '', s, flags=re.I)
    s = re.sub(r'\bD\.O\..*$', '', s, flags=re.I)
    s = s.replace(' y ', ', ')
    s = s.replace(';', ',').replace('.', ',')
    parts=[p.strip(' ,') for p in s.split(',') if p.strip(' ,')]
    # handle province references
    out=[]
    for p in parts:
        p = re.sub(r'^(las|los|la|el)\s+', '', p, flags=re.I)
        p = re.sub(r'^comunas?\s+de\s+', '', p, flags=re.I)
        p = re.sub(r'^provincia\s+de\s+', '', p, flags=re.I)
        p = p.strip()
        if not p: continue
        # special typo/noise
        p = p.replace('Llay-LLay','Llay-Llay').replace('Los Angeles','Los Angeles')
        out.append(p)
    return out

def canonicalize_comunas(names, comunas, asiento=None):
    by_norm={c['nombre_normalizado']: c['nombre'] for c in comunas}
    aliases={
        'calera':'La Calera', 'los angeles':'Los Angeles', 'coihaique':'Coihaique', 'aisen':'Aisén',
        'llay llay':'Llay-Llay', 'llayllay':'Llay-Llay', 'curico':'Curicó', 'quilpue':'Quilpué',
        'concepcion':'Concepción', 'valparaiso':'Valparaíso', 'vina del mar':'Viña del Mar',
        'maipu':'Maipú', 'nunoa':'Ñuñoa', 'penalolen':'Peñalolén', 'san joaquin':'San Joaquín',
        'pedro aguirre cerda':'Pedro Aguirre Cerda', 'la union':'La Unión', 'pucon':'Pucón',
        'rio bueno':'Río Bueno', 'rio negro':'Río Negro', 'rio ibañez':'Río Ibáñez', 'rio ibanez':'Río Ibáñez',
        'ohiggins': "O'Higgins", 'o higgins': "O'Higgins", 'coyhaique':'Coihaique', 'cañete':'Cañete',
        'chanaral':'Chañaral', 'tome':'Tomé', 'pitrufquen':'Pitrufquén', 'traiguen':'Traiguén',
        'mulchen':'Mulchén', 'quellon':'Quellón', 'natales':'Natales', 'puren':'Purén', 'yungay':'Yungay',
        'bulnes':'Bulnes', 'combarbala':'Combarbalá', 'curacautin':'Curacautín', 'lican­ten':'Licantén'
    }
    out=[]
    for n in names:
        nn=normalize_text(n)
        if nn in ('misma comuna','misma',''): 
            if asiento: out.append(asiento)
            continue
        if nn in by_norm: out.append(by_norm[nn])
        elif nn in aliases: out.append(aliases[nn])
        # handle provinces as fallback? omit if not exact.
    return sorted(set(out))

def infer_tipo(name):
    nn=normalize_text(name)
    if 'corte de apelaciones' in nn: return 'corte'
    if 'garantia' in nn: return 'garantía'
    if 'juicio oral' in nn or 'tribunal oral' in nn or 'penal' in nn and 'tribunal' in nn: return 'tribunal oral penal'
    if 'civil' in nn: return 'civil'
    if 'letras y garantia' in nn: return 'letras y garantía'
    if 'letras' in nn: return 'letras'
    return 'tribunal'

ORDINALS = {
    'primer':'1', 'primero':'1', 'segundo':'2', 'tercer':'3', 'tercero':'3', 'cuarto':'4', 'quinto':'5',
    'sexto':'6', 'septimo':'7', 'séptimo':'7', 'octavo':'8', 'noveno':'9', 'decimo':'10', 'décimo':'10',
    'undecimo':'11', 'undécimo':'11', 'duodecimo':'12', 'duodécimo':'12', 'decimotercer':'13',
    'decimocuarto':'14', 'decimoquinto':'15'
}

def tribunal_aliases(name):
    al=set([normalize_text(name)])
    nn=normalize_text(name)
    for word,num in ORDINALS.items():
        if nn.startswith(word+' '):
            al.add(normalize_text(num+' juzgado de garantia de santiago'))
            al.add(normalize_text(num+' juzgado de garantía de santiago'))
            al.add(normalize_text(num+' tribunal de juicio oral en lo penal de santiago'))
            al.add(normalize_text(num+' tribunal oral en lo penal de santiago'))
    return sorted(al)

def extract_asiento_from_tribunal(name):
    # Extract place after final DE; avoids JUZGADO DE LETRAS DE LOS ANDES -> LOS ANDES
    n = re.sub(r'\s+', ' ', name).strip()
    m = re.search(r'\bDE\s+(.+)$', n, flags=re.I)
    if m:
        return title_keep(m.group(1))
    return ''

def parse_tribunales_garantia(path, comunas):
    text=clean_legal_text(open(path, encoding='utf-8').read())
    sentences=re.split(r'(?<=[.;])\s+', text)
    tribunales=[]
    current_region=''
    for sent in sentences:
        mreg=re.search(r'((?:Primera|Segunda|Tercera|Cuarta|Quinta|Sexta|Séptima|Octava|Novena|Décima|Undécima|Duodécima|Decimocuarta|Decimoquinta|Región Metropolitana|Región de Ñuble)[^:]{0,80}):', sent)
        if mreg: current_region=mreg.group(1).strip()
        if 'competencia' not in sent.lower() or ', con ' not in sent: continue
        name=sent.split(', con ',1)[0].strip()
        name=re.sub(r'^.*:\s*','',name).strip()
        if len(name)>90 or 'Región' in name and 'Santiago' not in name: continue
        m = re.search(r'competencia\s+(?:sobre|en)\s+(?:las?|los?)\s+(?:comunas?|misma comuna)(?:\s+de\s+)?(.+?)(?:[.;]|$)', sent, flags=re.I)
        comunas_raw=[]
        if re.search(r'competencia\s+(?:sobre|en)\s+la\s+misma\s+comuna', sent, flags=re.I):
            comunas_raw=[name]
        elif m:
            comunas_raw=split_comunas_list(m.group(1))
        coms=canonicalize_comunas(comunas_raw, comunas, asiento=name)
        if not name or not coms: continue
        nombre = f"Juzgado de Garantía de {name}" if 'Juzgado de Garantía' not in name and 'Juzgado' not in name else name
        tribunales.append({
            'id': 'garantia-'+slugify(nombre), 'nombre': nombre, 'tipo': 'garantía', 'asiento': name,
            'corte': '', 'region': current_region, 'comunas_competencia': coms,
            'fuente_legal': 'juzgados-de-garantía.txt, Art. 16 COT', 'aliases': tribunal_aliases(nombre)
        })
    return tribunales

def parse_tribunales_top(path, comunas):
    text=clean_legal_text(open(path, encoding='utf-8').read())
    sentences=re.split(r'(?<=[.;])\s+', text)
    tribunales=[]; current_region=''
    for sent in sentences:
        mreg=re.search(r'((?:Primera|Segunda|Tercera|Cuarta|Quinta|Sexta|Séptima|Octava|Novena|Décima|Undécima|Duodécima|Decimocuarta|Decimoquinta|Región Metropolitana|Región de Ñuble)[^:]{0,80}):', sent)
        if mreg: current_region=mreg.group(1).strip()
        if 'competencia' not in sent.lower() or ', con ' not in sent: continue
        name=sent.split(', con ',1)[0].strip()
        name=re.sub(r'^.*:\s*','',name).strip()
        if len(name)>110 or not name: continue
        m = re.search(r'competencia\s+sobre\s+las\s+comunas\s+de\s+(.+?)(?:[.;]|$)', sent, flags=re.I)
        if not m: continue
        coms=canonicalize_comunas(split_comunas_list(m.group(1)), comunas)
        if not coms: continue
        nombre = f"Tribunal de Juicio Oral en lo Penal de {name}" if 'Tribunal de Juicio Oral' not in name and 'Tribunal' not in name else name
        tribunales.append({
            'id': 'top-'+slugify(nombre), 'nombre': nombre, 'tipo': 'tribunal oral penal', 'asiento': name,
            'corte': '', 'region': current_region, 'comunas_competencia': coms,
            'fuente_legal': 'Tribunal-Juicio-Oral.txt, Art. 21 COT', 'aliases': tribunal_aliases(nombre)
        })
    return tribunales

def parse_tribunales_letras(path, comunas):
    text=clean_legal_text(open(path, encoding='utf-8').read())
    # carve article 28-40 only before article 54
    text=text.split('Habrá en la República diecisiete Cortes',1)[0]
    sentences=re.split(r'(?<=[.;])\s+', text)
    tribunales=[]; current_region=''; current_tipo='letras'
    for sent in sentences:
        mreg=re.search(r'En la ([^,.;:]+Región[^,.;:]*|Región Metropolitana de Santiago|Región de Ñuble)', sent)
        if mreg: current_region=mreg.group(1).strip()
        if 'JUZGADOS CIVILES' in sent.upper(): current_tipo='civil'
        if 'COMPETENCIA COM' in sent.upper(): current_tipo='letras/competencia común'
        if 'asiento' not in sent.lower() or 'competencia' not in sent.lower(): continue
        m_as = re.search(r'asiento\s+en\s+(?:la\s+comuna\s+de\s+)?([^,.;]+)', sent, flags=re.I)
        if not m_as: continue
        asiento=m_as.group(1).strip()
        # fix short/noisy strings
        asiento=re.sub(r'\s+con\s.*$','',asiento, flags=re.I).strip()
        if len(asiento)>50: continue
        if re.search(r'misma comuna', sent, flags=re.I):
            comunas_raw=[asiento]
        else:
            mcom = re.search(r'competencia\s+sobre\s+(?:las?|los?)\s+(?:comunas?|provincia)\s+(?:de\s+)?(.+?)(?:[.;]|$)', sent, flags=re.I)
            comunas_raw=split_comunas_list(mcom.group(1)) if mcom else [asiento]
        coms=canonicalize_comunas(comunas_raw, comunas, asiento=asiento)
        if not coms: continue
        nombre = f"Juzgado de Letras de {asiento}"
        tribunales.append({
            'id': 'letras-'+slugify(nombre), 'nombre': nombre, 'tipo': current_tipo, 'asiento': asiento,
            'corte': '', 'region': current_region, 'comunas_competencia': coms,
            'fuente_legal': 'Juzgados-Código-Orgánico-de-Tribunales.txt, arts. 28-40 COT', 'aliases': [normalize_text(nombre), normalize_text(f'juzgado civil de {asiento}'), normalize_text(f'juzgado de letras y garantia de {asiento}')]
        })
    # Add special Santiago/San Miguel/Puente Alto from Art. 40 manually because syntax lacks exact asiento for San Miguel
    special = [
        ('Juzgados Civiles de Santiago','civil','Santiago', ['Santiago','Cerrillos','Cerro Navia','Conchalí','Estación Central','Huechuraba','Independencia','La Florida','La Reina','Las Condes','Lo Barnechea','Lo Prado','Macul','Maipú','Ñuñoa','Peñalolén','Providencia','Pudahuel','Quilicura','Quinta Normal','Recoleta','Renca','Vitacura'], 'Juzgados civiles de Santiago; provincia de Santiago con exclusiones del art. 40 COT.'),
        ('Juzgados Civiles de San Miguel','civil','San Miguel', ['San Miguel','San Joaquín','La Granja','La Pintana','San Ramón','Pedro Aguirre Cerda','La Cisterna','El Bosque','Lo Espejo'], 'Juzgados civiles de San Miguel; art. 40 COT.'),
        ('Juzgado Civil de Puente Alto','civil','Puente Alto', ['Puente Alto','Pirque','San José de Maipo'], 'Juzgado civil de Puente Alto; provincia de Cordillera, art. 40 COT.'),
    ]
    for nombre,tipo,asiento,raw,fuente in special:
        tribunales.append({'id':'letras-'+slugify(nombre),'nombre':nombre,'tipo':tipo,'asiento':asiento,'corte':'','region':'Región Metropolitana de Santiago','comunas_competencia':canonicalize_comunas(raw,comunas),'fuente_legal':fuente,'aliases':[normalize_text(nombre), normalize_text(f'juzgado civil de {asiento}'), normalize_text(f'1 juzgado civil de {asiento}')]})
    return tribunales

# ---------- Receptores builder ----------
def clean_email(s):
    s=(s or '').strip().strip(';').lower()
    if not s or '@' not in s: return ''
    return s

def normalize_phone_cl(phone, source_col='mobile'):
    raw = '' if phone is None else str(phone).strip()
    digits = re.sub(r'\D+', '', raw)
    flags=[]
    wa=None; normalized=''; is_mobile=False; is_valid=False
    if not digits:
        return {'raw': raw, 'normalized':'', 'isMobile':False, 'isValid':False, 'waNumber':'', 'flags':['missing_phone']}
    # Remove country/leading prefixes
    d=digits
    if d.startswith('0056'): d=d[4:]
    if d.startswith('56'): d=d[2:]
    if d.startswith('0') and len(d) in (9,10): d=d[1:]
    if len(d)==9 and d.startswith('9'):
        is_mobile=True; is_valid=True; normalized='+56 '+d[0]+' '+d[1:5]+' '+d[5:]; wa='56'+d
    elif source_col=='mobile' and len(d)==8 and d[0] in '6789':
        # old-style mobile values in source; safest usable WA normalization is to prefix 9 but flag it
        is_mobile=True; is_valid=True; flags.append('mobile_8_digit_prefixed_9_verify')
        dd='9'+d; normalized='+56 '+dd[0]+' '+dd[1:5]+' '+dd[5:]; wa='56'+dd
    elif len(d)==8:
        normalized='+56 2? '+d if source_col!='mobile' else d
        flags.append('not_mobile_or_ambiguous')
    else:
        normalized=d; flags.append('invalid_phone_format')
    return {'raw': raw, 'normalized': normalized, 'isMobile': is_mobile, 'isValid': is_valid, 'waNumber': wa or '', 'flags': flags}

def build_receptores(rows, comunas, cortes, tribunales):
    court_by_raw={normalize_text(k):v for k,v in COURT_CLEAN.items()}
    court_map={c['nombre_normalizado']: c for c in cortes}
    # tribunal lookup by normalized aliases and asiento
    tribunal_lookup={}
    asiento_lookup=defaultdict(list)
    for t in tribunales:
        keys=set([normalize_text(t['nombre'])] + t.get('aliases',[]))
        if t.get('asiento'):
            asiento_lookup[normalize_text(t['asiento'])].append(t)
        for k in keys:
            tribunal_lookup.setdefault(k, t)
    receptores=[]
    for idx,r in enumerate(rows, start=1):
        nombre,corte_raw,trib_raw,email1,email2,mobile,fijo = r
        corte = court_by_raw.get(normalize_text(corte_raw), title_keep(corte_raw))
        tribunal_name = title_keep(trib_raw).replace('Juzgado De', 'Juzgado de').replace('Letras Y Garantia','Letras y Garantía').replace('Garantia','Garantía').replace('Valparaiso','Valparaíso').replace('Concepcion','Concepción').replace('Copiapo','Copiapó').replace('Chillan','Chillán').replace('Curico','Curicó').replace('Quilpue','Quilpué').replace('Cañete','Cañete')
        tel=normalize_phone_cl(mobile, 'mobile')
        tel_fijo=normalize_phone_cl(fijo, 'fixed')
        emails=[e for e in [clean_email(email1), clean_email(email2)] if e]
        flags=[]; confidence=0.55
        if emails: confidence+=0.15
        else: flags.append('missing_email')
        if tel['isValid']: confidence+=0.2
        elif tel_fijo['raw']: flags.append('fixed_only_or_no_mobile')
        else: flags.append('missing_mobile')
        flags.extend(tel.get('flags',[]))
        coms=[]; related=[]; notas=[]
        tmatch=None
        ntrib=normalize_text(trib_raw)
        if ntrib in tribunal_lookup:
            tmatch=tribunal_lookup[ntrib]
        else:
            asiento=extract_asiento_from_tribunal(trib_raw)
            if asiento and normalize_text(asiento) in asiento_lookup:
                # choose first matching legal tribunal for asiento; receptor source usually civil/letras
                tmatch=asiento_lookup[normalize_text(asiento)][0]
        if tmatch and tmatch.get('comunas_competencia'):
            coms=tmatch['comunas_competencia']
            related=[tmatch['nombre']]
            confidence+=0.1
        elif normalize_text(trib_raw).startswith('corte de apelaciones') and normalize_text(corte) in court_map:
            coms=court_map[normalize_text(corte)]['regiones_comunas']
            related=[corte]
            flags.append('court_level_assignment')
            notas.append('Adscripción informada a nivel de Corte; comunas cubiertas inferidas desde territorio jurisdiccional de la Corte conforme al COT.')
            confidence+=0.05
        else:
            # fallback: use court territory but mark weak
            ct=court_map.get(normalize_text(corte))
            if ct:
                coms=ct['regiones_comunas']
                flags.append('territory_inferred_from_court_not_specific_tribunal')
                notas.append('No se encontró empate exacto tribunal-COT; territorio usado como referencia amplia de la Corte. Verificar antes de diligenciar.')
            else:
                flags.append('no_territory_inferred')
                notas.append('No fue posible inferir comunas cubiertas desde las fuentes disponibles.')
        if normalize_text(corte) in (normalize_text('Corte de Apelaciones de Santiago'), normalize_text('Corte de Apelaciones de San Miguel')):
            flags.append('santiago_san_miguel_rule')
            # For practical search, include both territories for Santiago/San Miguel because Art 391 allows cross-exercise.
            combined=set(coms)
            for cn in ['Corte de Apelaciones de Santiago','Corte de Apelaciones de San Miguel']:
                if normalize_text(cn) in court_map:
                    combined.update(court_map[normalize_text(cn)]['regiones_comunas'])
            coms=sorted(combined)
            notas.append('Regla especial: receptores adscritos a Santiago pueden ejercer en San Miguel y viceversa, sin exhorto, conforme al art. 391 COT.')
        # region names from comunas
        comuna_region={c['nombre']: c['region'] for c in comunas}
        regiones=sorted(set(comuna_region.get(x,'') for x in coms if comuna_region.get(x,'')))
        # comuna_base: asiento if available else first comuna or empty
        comuna_base=''
        if tmatch and tmatch.get('comunas_competencia') and tmatch.get('asiento'):
            comunas_names={c['nombre_normalizado']:c['nombre'] for c in comunas}
            comuna_base=comunas_names.get(normalize_text(tmatch['asiento']), tmatch['asiento'])
        elif coms:
            comuna_base=coms[0]
        item={
            'id': f'rec-{idx:04d}-{slugify(nombre)}',
            'nombre': title_keep(nombre),
            'nombre_original': nombre,
            'nombre_normalizado': normalize_text(nombre),
            'corte': corte,
            'corte_normalizada': normalize_text(corte),
            'territorio': corte,
            'comuna_base': comuna_base,
            'regiones': regiones,
            'comunas_cubiertas': coms,
            'tribunales_relacionados': related or ([tribunal_name] if tribunal_name else []),
            'tribunal_fuente': tribunal_name,
            'telefono': mobile or '',
            'telefono_normalizado': tel['normalized'],
            'telefono_whatsapp_normalizado': tel['waNumber'],
            'telefono_valido_whatsapp': bool(tel['waNumber']),
            'telefono_fijo': fijo or '',
            'email': emails[0] if emails else '',
            'emails': emails,
            'fuente': 'Poder Judicial - Transparencia.xlsx',
            'fecha_fuente': 'Archivo del proyecto; generado/consultado 2026-05-13',
            'notas': ' '.join(notas),
            'confidence_score': round(min(confidence,0.98),2),
            'flags_calidad': sorted(set(flags))
        }
        receptores.append(item)
    return receptores

# ---------- Search index ----------
def build_search_index(receptores, comunas, tribunales, cortes):
    aliases={
        'stgo': 'santiago', 's miguel': 'san miguel', 'valpo': 'valparaiso', 'vina': 'viña del mar',
        'viña': 'viña del mar', 'coyhaique': 'coihaique', 'coihaique': 'coihaique', 'los angeles':'los angeles',
        'calera': 'la calera', 'llay llay':'llay-llay', 'p las casas': 'padre las casas', 'p. las casas':'padre las casas',
        'garantia': 'garantía', 'jg':'juzgado garantía', 'top':'tribunal juicio oral penal', 'civil':'juzgado civil'
    }
    # build compact inverted tokens for suggestions only; frontend computes ranking on records
    tokens=Counter()
    for r in receptores:
        fields=[r['nombre'], r['corte'], r.get('tribunal_fuente','')] + r.get('comunas_cubiertas',[])[:12] + r.get('regiones',[])
        for f in fields:
            for tok in normalize_text(f).split():
                if len(tok)>1: tokens[tok]+=1
    return {'tokens':[{'token':k,'count':v} for k,v in tokens.most_common(1000)], 'aliases': aliases, 'ngrams': [], 'referencias_cruzadas': {'receptores':len(receptores),'comunas':len(comunas),'tribunales':len(tribunales),'cortes':len(cortes)}}

# ---------- Main ----------
def main():
    header, rows=parse_xlsx_basic(os.path.join(BASE,'Poder Judicial - Transparencia.xlsx'))
    comunas=parse_comunas(os.path.join(BASE,'Comunas-de-Chile.txt'))
    cortes=build_cortes(comunas)
    tribunales=[]
    tribunales += parse_tribunales_letras(os.path.join(BASE,'Juzgados-Código-Orgánico-de-Tribunales.txt'), comunas)
    tribunales += parse_tribunales_garantia(os.path.join(BASE,'juzgados-de-garantía.txt'), comunas)
    tribunales += parse_tribunales_top(os.path.join(BASE,'Tribunal-Juicio-Oral.txt'), comunas)
    # Add unique tribunal names from xlsx to table, merging if possible by normal form
    existing={normalize_text(t['nombre']) for t in tribunales}
    for tr in sorted(set(r[2] for r in rows if r[2])):
        pretty=title_keep(tr).replace('Garantia','Garantía').replace('Valparaiso','Valparaíso').replace('Concepcion','Concepción').replace('Copiapo','Copiapó').replace('Chillan','Chillán').replace('Curico','Curicó').replace('Quilpue','Quilpué')
        if normalize_text(pretty) not in existing:
            tribunales.append({'id':'fuente-'+slugify(pretty),'nombre':pretty,'tipo':infer_tipo(pretty),'asiento':extract_asiento_from_tribunal(tr),'corte':'','region':'','comunas_competencia':[],'fuente_legal':'Poder Judicial - Transparencia.xlsx','aliases':[normalize_text(pretty)]})
            existing.add(normalize_text(pretty))
    receptores=build_receptores(rows, comunas, cortes, tribunales)
    search_index=build_search_index(receptores, comunas, tribunales, cortes)
    meta={
        'app':'Receptores Chile',
        'generado':'2026-05-13',
        'fuentes':[
            {'archivo':'Poder Judicial - Transparencia.xlsx','uso':'directorio de receptores, correos y teléfonos'},
            {'archivo':'Receptores-COT.txt','uso':'reglas jurídicas sobre receptores, art. 390-393 COT'},
            {'archivo':'Juzgados-Código-Orgánico-de-Tribunales.txt','uso':'juzgados de letras/civiles y territorios de Cortes, arts. 28-40 y 54-55 COT'},
            {'archivo':'juzgados-de-garantía.txt','uso':'juzgados de garantía y comunas de competencia'},
            {'archivo':'Tribunal-Juicio-Oral.txt','uso':'tribunales de juicio oral en lo penal y comunas de competencia'},
            {'archivo':'Comunas-de-Chile.txt','uso':'normalización territorial comuna/provincia/región/coordenadas'},
            {'archivo':'neocities-receptoreschile.zip','uso':'referencia técnica/prototipo anterior; no usado como fuente primaria'}
        ],
        'conteos':{
            'receptores':len(receptores), 'receptores_con_whatsapp':sum(1 for r in receptores if r['telefono_valido_whatsapp']),
            'receptores_con_email':sum(1 for r in receptores if r['email']), 'comunas':len(comunas), 'tribunales':len(tribunales), 'cortes':len(cortes)
        },
        'disclaimer':'Sitio no oficial. No reemplaza la verificación ante el Poder Judicial ni el tribunal correspondiente.'
    }
    for name,obj in [('receptores.json',receptores),('comunas.json',comunas),('tribunales.json',tribunales),('cortes.json',cortes),('search-index.json',search_index),('meta.json',meta)]:
        with open(os.path.join(OUT,'data',name),'w',encoding='utf-8') as f: json.dump(obj,f,ensure_ascii=False,separators=(',',':'))
    print(json.dumps(meta,ensure_ascii=False,indent=2))
    # Print a few QA searches against raw data
    print('Sample receptors:', receptores[0], receptores[1])

if __name__=='__main__':
    main()
