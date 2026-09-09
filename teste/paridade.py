#!/usr/bin/env python3
"""Prova que o núcleo JS e o `aquarela.py` produzem os mesmos pixels.

A mesma imagem passa pelas duas implementações e os bytes RGBA são comparados
um a um. Qualquer divergência é impressa com o pixel onde acontece.

    python3 teste/paridade.py imagem.png [--limpar 0.02] [--ganho 1.0]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from aquarela import estimar_papel, separar  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('imagem', type=Path)
    p.add_argument('--limpar', type=float, default=0.02)
    p.add_argument('--ganho', type=float, default=1.0)
    p.add_argument('--modo', choices=('aquarela', 'chapado'), default='aquarela')
    p.add_argument('--tolerancia', type=float, default=30.0)
    p.add_argument('--suavidade', type=float, default=60.0)
    p.add_argument('--resto', type=float, default=0.0)
    args = p.parse_args()

    imagem = Image.open(args.imagem).convert('RGB')
    pixels = np.asarray(imagem).astype(float)
    altura, largura = pixels.shape[:2]

    papel = estimar_papel(pixels)
    pigmento, cobertura = separar(
        pixels, papel, args.limpar, args.ganho,
        args.modo, args.tolerancia, args.suavidade, args.resto,
    )
    py = np.dstack([pigmento, cobertura * 255.0]).astype(np.uint8)

    with tempfile.TemporaryDirectory() as tmp:
        entrada = Path(tmp) / 'entrada.raw'
        saida = Path(tmp) / 'saida.raw'
        # O núcleo JS recebe RGBA, que é o que uma tela de canvas entrega.
        rgba_entrada = np.dstack([
            np.asarray(imagem), np.full((altura, largura), 255, dtype=np.uint8)
        ])
        entrada.write_bytes(rgba_entrada.astype(np.uint8).tobytes())

        opcoes = json.dumps({
            'limpar': args.limpar, 'ganho': args.ganho, 'modo': args.modo,
            'tolerancia': args.tolerancia, 'suavidade': args.suavidade,
            'resto': args.resto, 'papel': [float(c) for c in papel],
        })
        r = subprocess.run(
            ['node', str(RAIZ / 'teste' / 'nucleo.mjs'), str(entrada),
             str(largura), str(altura), str(saida), opcoes],
            capture_output=True, text=True, check=False,
        )
        if r.returncode != 0:
            print(r.stderr, file=sys.stderr)
            return 2
        do_js = json.loads(r.stdout)
        js = np.frombuffer(saida.read_bytes(), dtype=np.uint8).reshape(altura, largura, 4)

    papel_py = [int(round(c)) for c in papel]
    print(f'papel  python={papel_py}  js={do_js["papel"]}')
    if papel_py != do_js['papel']:
        print('DIVERGE: a cor do papel estimada difere.')
        return 1

    diferentes = np.argwhere(py != js)
    total = py.size
    if len(diferentes):
        y, x, c = diferentes[0]
        print(f'DIVERGE em {len(diferentes)} de {total} bytes '
              f'({len(diferentes) / total:.6%}).')
        print(f'  primeiro: pixel ({x}, {y}) canal {"RGBA"[c]}  '
              f'python={py[y, x, c]}  js={js[y, x, c]}')
        print(f'  maior diferenca: {int(np.abs(py.astype(int) - js.astype(int)).max())}')
        return 1

    print(f'IDENTICO: {total} bytes conferidos, nenhuma diferenca.')
    print(f'  transparente={do_js["transparente"]:.0%} '
          f'aguada={do_js["aguada"]:.0%} opaco={do_js["opaco"]:.0%}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
