"""Qual fundo permite a melhor recuperacao, por tipo de criatura.

A verdade NAO pode sair da propria aquarela.py: o resultado dela e um ponto fixo
do algoritmo (a cobertura escolhida e a minima compativel, o que zera um canal do
pigmento) e a recuperacao sairia exata por construcao. Aqui o alfa vem de uma
separacao real — para ter bordas e aguadas de verdade — mas o pigmento e pintado
por cima, com todos os canais longe de zero.
"""
import sys
import numpy as np
from PIL import Image
sys.path.insert(0, '/home/user/aquarelapy')
from aquarela import separar

D = '/tmp/claude-0/-home-user/6f41cb7f-af72-578b-865a-cface2781a93/scratchpad'
v = np.asarray(Image.open(D + '/exato-0.png').convert('RGBA')).astype(float)
v = np.asarray(Image.fromarray(v.astype(np.uint8)).resize((512, 279), Image.LANCZOS)).astype(float)
alfa = v[..., 3:] / 255.0
luz = v[..., :3].mean(axis=2, keepdims=True) / 255.0   # so a forma, para variar o tom

def pintar(escuro, claro):
    """Pigmento independente: interpola entre duas cores escolhidas."""
    e = np.array(escuro, float)
    c = np.array(claro, float)
    return np.clip(e + (c - e) * luz, 0, 255)

sujeitos = {
    'colorida':      pintar((120,  60,  35), (205, 150,  90)),   # ocre/terra, canais longe de 0
    'esbranquicada': pintar((215, 205, 190), (252, 250, 246)),   # quase branca
    'escura':        pintar(( 18,  16,  22), ( 70,  62,  78)),   # quase preta
}

fundos = {
    'papel branco': (253, 250, 239),
    'cinza medio':  (128, 128, 128),
    'preto':        ( 18,  16,  15),
    'verde':        (106, 159,  63),
    'azul':         ( 40,  70, 190),
    'magenta':      (190,  40, 160),
}

# A distancia do preto ao branco no espaco RGB e 441: a grade precisa alcancar
# rampas largas, senao o fundo preto e condenado por limitacao do teste.
grade = ([('aquarela', dict(limpar=l, ganho=g))
          for l in (0.0, 0.02) for g in (0.7, 1.0, 1.3, 1.7, 2.2, 3.0)]
       + [('chapado', dict(tolerancia=t, suavidade=s, resto=r))
          for t in (0, 5, 20, 45, 80) for s in (20, 40, 90, 150, 250, 350, 450)
          for r in (0.0, 0.8)])

onde = alfa[..., 0] > 0.03
peso = alfa[..., 0][onde]

print(f'{"criatura":15} {"fundo":13} {"modo":9} {"erro cor":>9} {"erro alfa":>10}   (0 = perfeito, 255 = pior)')
print('-' * 78)
for nome_s, pintura in sujeitos.items():
    base = pintura * alfa
    linhas = []
    for nome_f, cor in fundos.items():
        fundo = np.array(cor, dtype=float)
        obs = base + fundo * (1 - alfa)
        melhor = None
        for modo, kw in grade:
            pig, cob = separar(
                obs, fundo, kw.get('limpar', 0.02), kw.get('ganho', 1.0), modo,
                kw.get('tolerancia', 30.0), kw.get('suavidade', 60.0), kw.get('resto', 0.0),
            )
            e_cor = float((np.abs(pig - pintura).mean(axis=2)[onde] * peso).sum() / peso.sum())
            e_alfa = float(np.abs(cob - alfa[..., 0])[onde].mean() * 255)
            if melhor is None or e_cor + e_alfa < melhor[0]:
                melhor = (e_cor + e_alfa, modo, e_cor, e_alfa)
        linhas.append((melhor[0], nome_f, melhor[1], melhor[2], melhor[3]))
    for _, nome_f, modo, e_cor, e_alfa in sorted(linhas):
        print(f'{nome_s:15} {nome_f:13} {modo:9} {e_cor:9.1f} {e_alfa:10.1f}')
    print()
