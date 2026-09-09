#!/usr/bin/env python3
"""Tira o papel de uma aquarela, preservando as aguadas.

Não é recorte de fundo. Uma aquarela é pigmento translúcido *sobre* papel:
o que se vê em cada ponto é uma mistura entre a tinta e o papel por baixo.
Recortar por semelhança de cor destrói as aguadas claras, que são quase papel.

Aqui o que se faz é desfazer essa mistura. Assumindo

    observado = pigmento · cobertura + papel · (1 - cobertura)

estima-se a cobertura pelo canal que mais escureceu em relação ao papel e
recupera-se o pigmento. O resultado é um PNG com transparência real que,
sobreposto a qualquer fundo, se comporta como a tinta se comportaria sobre
aquele fundo — inclusive nos tons escuros.

Uso:
    python3 ferramentas/aquarela.py entrada.jpg
    python3 ferramentas/aquarela.py entrada.jpg --saida capa.png --papel '#fcf9ed'
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit('Faltam dependências. Instale com: pip install pillow numpy')


def ler_cor(texto: str) -> np.ndarray:
    valor = texto.strip().lstrip('#')
    if len(valor) == 3:
        valor = ''.join(c * 2 for c in valor)
    if len(valor) != 6:
        raise argparse.ArgumentTypeError(f'Cor inválida: {texto}')
    return np.array([int(valor[i : i + 2], 16) for i in (0, 2, 4)], dtype=float)


def estimar_papel(pixels: np.ndarray, margem: int = 6) -> np.ndarray:
    """Cor do papel medida nas bordas, onde raramente há tinta."""
    bordas = np.concatenate(
        [
            pixels[:margem].reshape(-1, 3),
            pixels[-margem:].reshape(-1, 3),
            pixels[:, :margem].reshape(-1, 3),
            pixels[:, -margem:].reshape(-1, 3),
        ]
    )
    # A mediana ignora manchas que encostem na borda.
    return np.median(bordas, axis=0)


def separar(
    pixels: np.ndarray,
    papel: np.ndarray,
    limpar: float,
    ganho: float,
) -> tuple[np.ndarray, np.ndarray]:
    papel_seguro = np.maximum(papel, 1.0)

    # Quanto cada canal escureceu em relação ao papel, em proporção.
    escurecimento = (papel - pixels) / papel_seguro
    cobertura = np.clip(escurecimento.max(axis=2) * ganho, 0.0, 1.0)

    # Ruído de compressão perto do papel vira transparência limpa.
    cobertura[cobertura < limpar] = 0.0

    a = cobertura[..., None]
    with np.errstate(divide='ignore', invalid='ignore'):
        pigmento = (pixels - papel * (1.0 - a)) / a
    pigmento = np.nan_to_num(pigmento, nan=0.0, posinf=255.0, neginf=0.0)
    return np.clip(pigmento, 0, 255), cobertura


def aparar(rgba: np.ndarray) -> np.ndarray:
    """Remove as margens totalmente transparentes."""
    visivel = rgba[..., 3] > 0
    if not visivel.any():
        return rgba
    linhas = np.where(visivel.any(axis=1))[0]
    colunas = np.where(visivel.any(axis=0))[0]
    return rgba[linhas[0] : linhas[-1] + 1, colunas[0] : colunas[-1] + 1]


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Tira o papel de uma aquarela e devolve um PNG com transparência real.',
    )
    parser.add_argument('entrada', type=Path, help='Imagem de origem (jpg, png…).')
    parser.add_argument('--saida', type=Path, help='PNG de destino. Padrão: <entrada>-sem-papel.png')
    parser.add_argument(
        '--papel',
        type=ler_cor,
        help='Cor do papel, ex.: "#fcf9ed". Padrão: medida nas bordas da imagem.',
    )
    parser.add_argument(
        '--limpar',
        type=float,
        default=0.02,
        help='Abaixo desta cobertura o pixel vira transparente puro (0 a 1). Padrão: 0.02.',
    )
    parser.add_argument(
        '--ganho',
        type=float,
        default=1.0,
        help='Multiplica a cobertura. Acima de 1 deixa a tinta mais densa. Padrão: 1.0.',
    )
    parser.add_argument('--aparar', action='store_true', help='Corta as margens transparentes.')
    args = parser.parse_args()

    imagem = Image.open(args.entrada).convert('RGB')
    pixels = np.asarray(imagem).astype(float)

    papel = args.papel if args.papel is not None else estimar_papel(pixels)
    pigmento, cobertura = separar(pixels, papel, args.limpar, args.ganho)

    rgba = np.dstack([pigmento, cobertura * 255.0]).astype(np.uint8)
    if args.aparar:
        rgba = aparar(rgba)

    saida = args.saida or args.entrada.with_name(f'{args.entrada.stem}-sem-papel.png')
    Image.fromarray(rgba, 'RGBA').save(saida)

    opacos = int((cobertura > 0.98).sum())
    transparentes = int((cobertura == 0).sum())
    total = cobertura.size
    hexa = ''.join('%02x' % int(round(c)) for c in papel)
    print('Papel usado: #' + hexa)
    print(f'Gravado em: {saida}')
    print(
        f'Transparente: {transparentes / total:.0%} · '
        f'Opaco: {opacos / total:.0%} · '
        f'Aguada: {(total - opacos - transparentes) / total:.0%}'
    )


if __name__ == '__main__':
    main()
