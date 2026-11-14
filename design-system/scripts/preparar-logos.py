"""
Prepara as logos oficiais do Golden Park para a web, SEM redesenhar nada:
  1. remove o fundo creme opaco (vira transparência, com bordas suaves e sem halo);
  2. recorta: logo completa, símbolo (emblema GP) e nome ("Golden Park").

Entradas (fornecidas pela equipe, guardadas sem alteração):
  design-system/brand/golden-park-claro-original.jpg   dourada e preta  → modo claro
  design-system/brand/golden-park-escuro-original.jpg  dourada e bege   → modo escuro

Saídas: design-system/brand/golden-park-{claro,escuro}-{completo,simbolo,nome}.png
        (cópia em apps/web/public/marca/ para a aplicação web)

Uso:  python design-system/scripts/preparar-logos.py
"""
from pathlib import Path
from PIL import Image

RAIZ = Path(__file__).resolve().parents[2]
MARCA = RAIZ / 'design-system' / 'brand'
WEB = RAIZ / 'apps' / 'web' / 'public' / 'marca'
T0, T1 = 8.0, 42.0
ALTURA_WEB = {'completo': 480, 'simbolo': 240, 'nome': 96}  # altura das cópias da web (px, ~2x o maior uso)  # distância do fundo: abaixo de T0 = transparente; acima de T1 = opaco


def sem_fundo(im: Image.Image) -> Image.Image:
    im = im.convert('RGB')
    w, h = im.size
    cantos = [im.getpixel(p) for p in [(4, 4), (w - 5, 4), (4, h - 5), (w - 5, h - 5)]]
    fundo = tuple(sum(c[i] for c in cantos) / 4 for i in range(3))
    px = im.load()
    saida = Image.new('RGBA', (w, h))
    out = saida.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            d = ((r - fundo[0]) ** 2 + (g - fundo[1]) ** 2 + (b - fundo[2]) ** 2) ** 0.5
            a = 0.0 if d <= T0 else 1.0 if d >= T1 else (d - T0) / (T1 - T0)
            if a <= 0:
                out[x, y] = (0, 0, 0, 0)
                continue
            # remove a mistura com o fundo nas bordas (evita halo claro no tema escuro)
            cor = tuple(max(0, min(255, round((c - (1 - a) * f) / a))) for c, f in zip((r, g, b), fundo))
            out[x, y] = (*cor, round(a * 255))
    return saida


def faixas_de_conteudo(im: Image.Image, minimo=3):
    """Faixas horizontais (linhas) com conteúdo, separadas por linhas vazias."""
    alfa = im.getchannel('A')
    w, h = im.size
    linhas = [alfa.crop((0, y, w, y + 1)).getbbox() is not None for y in range(h)]
    faixas, ini = [], None
    for y, tem in enumerate(linhas + [False]):
        if tem and ini is None:
            ini = y
        elif not tem and ini is not None:
            if y - ini >= minimo:
                faixas.append((ini, y))
            ini = None
    return faixas


def recortar(im: Image.Image, y0: int, y1: int, margem=12) -> Image.Image:
    parte = im.crop((0, y0, im.size[0], y1))
    caixa = parte.getbbox()
    parte = parte.crop(caixa)
    tela = Image.new('RGBA', (parte.size[0] + 2 * margem, parte.size[1] + 2 * margem), (0, 0, 0, 0))
    tela.paste(parte, (margem, margem))
    return tela


def processar(tema: str):
    im = sem_fundo(Image.open(MARCA / f'golden-park-{tema}-original.jpg'))
    faixas = faixas_de_conteudo(im)
    # emblema = primeira faixa (a mais alta da imagem); nome = a faixa mais alta entre as seguintes
    # (ignora ruídos finos de compressão do JPG); a última faixa é a linha "Sistema inteligente..."
    topo, base = faixas[0]
    nome = max(faixas[1:-1], key=lambda f: f[1] - f[0])
    saidas = {
        'completo': recortar(im, faixas[0][0], faixas[-1][1], 24),
        'simbolo': recortar(im, topo, base),
        'nome': recortar(im, nome[0], nome[1]),
    }
    for chave, img in saidas.items():
        destino = MARCA / f'golden-park-{tema}-{chave}.png'
        img.save(destino, optimize=True)
        # cópia da web reduzida (mesma proporção) para carregar rápido; a original fica no Design System
        web = img.copy()
        alvo = ALTURA_WEB[chave]
        web = web.resize((round(web.size[0] * alvo / web.size[1]), alvo), Image.LANCZOS)
        web.save(WEB / destino.name, optimize=True)
        print(destino.name, img.size)


if __name__ == '__main__':
    WEB.mkdir(parents=True, exist_ok=True)
    for tema in ('claro', 'escuro'):
        processar(tema)
