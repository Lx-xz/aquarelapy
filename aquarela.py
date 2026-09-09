#!/usr/bin/env python3
"""Tira o fundo de uma ilustração, preservando as aguadas.

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


def cobertura_aquarela(
    pixels: np.ndarray, papel: np.ndarray, limpar: float, ganho: float,
) -> np.ndarray:
    """Cobertura de tinta translúcida sobre papel claro.

    A tinta só escurece o papel, então a cobertura sai do canal que mais
    escureceu, em proporção à folga que havia até o preto.
    """
    papel_seguro = np.maximum(papel, 1.0)
    escurecimento = (papel - pixels) / papel_seguro
    cobertura = np.clip(escurecimento.max(axis=2) * ganho, 0.0, 1.0)
    # Ruído de compressão perto do papel vira transparência limpa.
    cobertura[cobertura < limpar] = 0.0
    return cobertura


def cobertura_chapada(
    pixels: np.ndarray, fundo: np.ndarray, tolerancia: float, suavidade: float,
) -> np.ndarray:
    """Cobertura contra um fundo de cor chapada.

    Aqui o fundo não é papel por baixo da tinta: é uma cor atrás de um desenho
    que costuma ser opaco. O que separa os dois é a *distância de cor*, não o
    escurecimento — um cinza neutro está longe de um verde mesmo tendo brilho
    parecido, e é justamente isso que a medida por canal não enxerga. Sem isto,
    um desenho claro sobre fundo colorido some, e as sombras neutras voltam
    tingidas do complementar do fundo.
    """
    distancia = np.sqrt(((pixels - fundo) ** 2).sum(axis=2))
    return np.clip((distancia - tolerancia) / max(suavidade, 1.0), 0.0, 1.0)


def tirar_resto_do_fundo(
    pigmento: np.ndarray, fundo: np.ndarray, forca: float,
) -> np.ndarray:
    """Tira das bordas o resto do matiz do fundo.

    Num pixel de transição parte do que se vê é fundo, e quando a cobertura é
    subestimada sobra matiz: a franja verde na borda de um desenho sobre verde.

    Remove-se só a parte da cor que aponta para o matiz do fundo *mais forte do
    que aponta para qualquer outro lado*. Decompondo a cor do pixel — sem o
    brilho — numa componente ao longo do matiz do fundo e outra perpendicular a
    ele, sai apenas o quanto a primeira excede a segunda.

    É essa comparação que torna a remoção segura. Uma franja verde é quase toda
    componente verde, e sai inteira. Um ocre também contém verde, mas contém
    muito mais vermelho: a componente perpendicular é maior, o excesso é zero e
    ele não é tocado. A tentativa anterior pesava a remoção por `1 - cobertura`
    e não funcionava — com rampa apertada a borda já chega opaca, e o peso
    zerava justamente onde a franja está.

    O limite é inerente: uma cor *legitimamente* do matiz do fundo sai junto.
    Não se recorta um desenho verde sobre fundo verde.
    """
    if forca <= 0:
        return pigmento
    direcao = fundo - fundo.mean()          # a cor do fundo sem o brilho dela
    # Raiz da soma dos quadrados: np.linalg.norm escalona e nao casaria com o
    # nucleo do navegador no ultimo bit.
    norma = float(np.sqrt((direcao ** 2).sum()))
    if norma < 1e-6:                        # fundo neutro: nao ha matiz a tirar
        return pigmento
    direcao = direcao / norma

    cor = pigmento - pigmento.mean(axis=2, keepdims=True)
    ao_longo = (cor * direcao).sum(axis=2, keepdims=True)
    perpendicular = np.sqrt(
        np.maximum((cor ** 2).sum(axis=2, keepdims=True) - ao_longo ** 2, 0.0)
    )
    excesso = np.maximum(ao_longo - perpendicular, 0.0)
    return np.clip(pigmento - direcao * excesso * forca, 0, 255)


def fundo_conectado(
    pixels: np.ndarray, fundo: np.ndarray, parecido: float,
) -> np.ndarray:
    """Marca o fundo que *encosta na borda* da imagem.

    Cor sozinha não distingue o fundo de uma parte do desenho que por acaso tem
    a cor dele — a sobrancelha escura de um grifo sobre preto é o exemplo. Quem
    distingue é a vizinhança: o fundo é uma região contínua que chega até a
    borda do quadro. Uma ilha da mesma cor, cercada de desenho, não é fundo.

    Inundação a partir das quatro bordas, por vizinhança de quatro.
    """
    altura, largura = pixels.shape[:2]
    candidato = np.sqrt(((pixels - fundo) ** 2).sum(axis=2)) < parecido
    alcancado = np.zeros((altura, largura), dtype=bool)

    plano = candidato.ravel()
    visto = alcancado.ravel()
    pilha: list[int] = []
    for x in range(largura):
        for y in (0, altura - 1):
            i = y * largura + x
            if plano[i] and not visto[i]:
                visto[i] = True
                pilha.append(i)
    for y in range(altura):
        for x in (0, largura - 1):
            i = y * largura + x
            if plano[i] and not visto[i]:
                visto[i] = True
                pilha.append(i)

    while pilha:
        i = pilha.pop()
        y, x = divmod(i, largura)
        if x > 0 and plano[i - 1] and not visto[i - 1]:
            visto[i - 1] = True
            pilha.append(i - 1)
        if x < largura - 1 and plano[i + 1] and not visto[i + 1]:
            visto[i + 1] = True
            pilha.append(i + 1)
        if y > 0 and plano[i - largura] and not visto[i - largura]:
            visto[i - largura] = True
            pilha.append(i - largura)
        if y < altura - 1 and plano[i + largura] and not visto[i + largura]:
            visto[i + largura] = True
            pilha.append(i + largura)

    return alcancado


def abrir_bolsoes(
    candidato: np.ndarray, alcancado: np.ndarray, maior_ilha: int,
) -> np.ndarray:
    """Devolve ao fundo as ilhas grandes cercadas pelo desenho.

    A inundação não chega a um bolsão de fundo fechado pelo próprio desenho — o
    vão entre o corpo e a asa de um grifo. Ele ficaria opaco, como se fosse
    tinta. O que separa um bolsão de um detalhe é o tamanho: medido numa
    ilustração, as duas ilhas de fundo tinham 11.716 e 2.726 pixels, e as 1.273
    ilhas de traço escuro tinham todas menos de 500.
    """
    if maior_ilha <= 0:
        return alcancado

    altura, largura = candidato.shape
    ilha = candidato & ~alcancado
    plano = ilha.ravel()
    saida = alcancado.ravel().copy()
    visto = np.zeros(plano.size, dtype=bool)

    for semente in np.flatnonzero(plano):
        if visto[semente]:
            continue
        grupo = [semente]
        visto[semente] = True
        k = 0
        while k < len(grupo):
            i = grupo[k]
            k += 1
            y, x = divmod(i, largura)
            for j, ok in (
                (i - 1, x > 0), (i + 1, x < largura - 1),
                (i - largura, y > 0), (i + largura, y < altura - 1),
            ):
                if ok and plano[j] and not visto[j]:
                    visto[j] = True
                    grupo.append(j)
        if len(grupo) > maior_ilha:
            saida[grupo] = True

    return saida.reshape(altura, largura)


def dilatar(mascara: np.ndarray, passos: int) -> np.ndarray:
    """Engorda a máscara em `passos` pixels, por vizinhança de quatro."""
    for _ in range(passos):
        crescida = mascara.copy()
        crescida[1:, :] |= mascara[:-1, :]
        crescida[:-1, :] |= mascara[1:, :]
        crescida[:, 1:] |= mascara[:, :-1]
        crescida[:, :-1] |= mascara[:, 1:]
        mascara = crescida
    return mascara


def separar(
    pixels: np.ndarray,
    papel: np.ndarray,
    limpar: float = 0.02,
    ganho: float = 1.0,
    modo: str = 'aquarela',
    tolerancia: float = 30.0,
    suavidade: float = 60.0,
    resto: float = 0.0,
    conectado: float = 0.0,
    banda: int = 3,
    maior_ilha: int = 0,
) -> tuple[np.ndarray, np.ndarray]:
    cobertura = (
        cobertura_chapada(pixels, papel, tolerancia, suavidade)
        if modo == 'chapado'
        else cobertura_aquarela(pixels, papel, limpar, ganho)
    )

    if conectado > 0:
        # A inundação decide *o que* é fundo; a rampa decide só a maciez da
        # borda. Com o miolo protegido, a rampa pode ser larga sem comer o
        # desenho — era essa a amarra que fazia o preto apagar a sobrancelha.
        fora = fundo_conectado(pixels, papel, conectado)
        if maior_ilha > 0:
            candidato = np.sqrt(((pixels - papel) ** 2).sum(axis=2)) < conectado
            fora = abrir_bolsoes(candidato, fora, maior_ilha)
        faixa = dilatar(fora, banda) & ~fora
        dentro = ~fora & ~faixa
        cobertura = np.where(fora, 0.0, np.where(dentro, 1.0, cobertura))

    a = cobertura[..., None]
    with np.errstate(divide='ignore', invalid='ignore'):
        pigmento = (pixels - papel * (1.0 - a)) / a
    pigmento = np.nan_to_num(pigmento, nan=0.0, posinf=255.0, neginf=0.0)
    pigmento = np.clip(pigmento, 0, 255)
    return tirar_resto_do_fundo(pigmento, papel, resto), cobertura


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
    parser.add_argument(
        '--modo',
        choices=('aquarela', 'chapado'),
        default='aquarela',
        help='"aquarela": tinta translúcida sobre papel claro (padrão). '
             '"chapado": fundo de cor chapada atrás de um desenho opaco — use '
             'quando o desenho puder ser mais claro que o fundo.',
    )
    parser.add_argument(
        '--tolerancia',
        type=float,
        default=30.0,
        help='Só no modo chapado: distância de cor abaixo da qual o pixel é '
             'fundo puro. Padrão: 30.',
    )
    parser.add_argument(
        '--suavidade',
        type=float,
        default=60.0,
        help='Só no modo chapado: largura da rampa acima da tolerância, onde a '
             'borda ganha transparência parcial. Padrão: 60.',
    )
    parser.add_argument(
        '--conectado',
        type=float,
        default=0.0,
        metavar='DISTANCIA',
        help='Só é fundo o que encosta na borda do quadro. O valor é a distância '
             'de cor que ainda conta como fundo na inundação (ex.: 60). Protege '
             'traço escuro dentro de desenho claro, que a cor sozinha apagaria. '
             'Padrão: 0, desligado.',
    )
    parser.add_argument(
        '--banda',
        type=int,
        default=3,
        help='Largura, em pixels, da faixa de transição na borda quando '
             '--conectado está ligado. Padrão: 3.',
    )
    parser.add_argument(
        '--ilha',
        type=int,
        default=0,
        metavar='PIXELS',
        help='Só com --conectado: ilha de cor de fundo cercada pelo desenho, '
             'maior que isto, volta a ser fundo. Serve para o vão entre o corpo '
             'e a asa, que a inundação não alcança. Padrão: 0, nenhuma volta.',
    )
    parser.add_argument(
        '--resto',
        type=float,
        default=0.0,
        help='Quanto do matiz do fundo tirar das bordas, de 0 a 1. Contra fundo '
             'chapado colorido, 0.8 costuma varrer a franja. Padrão: 0.',
    )
    args = parser.parse_args()

    imagem = Image.open(args.entrada).convert('RGB')
    pixels = np.asarray(imagem).astype(float)

    papel = args.papel if args.papel is not None else estimar_papel(pixels)
    pigmento, cobertura = separar(
        pixels, papel, args.limpar, args.ganho,
        args.modo, args.tolerancia, args.suavidade, args.resto,
        args.conectado, args.banda, args.ilha,
    )

    rgba = np.dstack([pigmento, cobertura * 255.0]).astype(np.uint8)
    if args.aparar:
        rgba = aparar(rgba)

    saida = args.saida or args.entrada.with_name(f'{args.entrada.stem}-sem-papel.png')
    Image.fromarray(rgba, 'RGBA').save(saida)

    opacos = int((cobertura > 0.98).sum())
    transparentes = int((cobertura == 0).sum())
    total = cobertura.size
    hexa = ''.join('%02x' % int(round(c)) for c in papel)
    print(('Fundo usado: #' if args.modo == 'chapado' else 'Papel usado: #') + hexa)
    print(f'Gravado em: {saida}')
    print(
        f'Transparente: {transparentes / total:.0%} · '
        f'Opaco: {opacos / total:.0%} · '
        f'Aguada: {(total - opacos - transparentes) / total:.0%}'
    )


if __name__ == '__main__':
    main()
