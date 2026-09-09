# Aquarela

Tira o papel de uma aquarela e devolve um PNG com transparência real.

Não é recorte de fundo. Uma aquarela é pigmento translúcido **sobre** papel: o
que se vê em cada ponto é uma mistura entre a tinta e o papel por baixo.
Recortar por semelhança de cor destrói as aguadas claras, que são quase papel.

O que se faz aqui é desfazer a mistura. Assumindo

```
observado = pigmento · cobertura + papel · (1 - cobertura)
```

estima-se a cobertura pelo canal que mais escureceu em relação ao papel e
recupera-se o pigmento. O resultado, sobreposto a qualquer fundo, se comporta
como a tinta se comportaria sobre aquele fundo.

## Duas maneiras de usar

**Na página.** Uma página só, sem servidor: arraste a imagem, mexa nos
controles, veja o antes e o depois lado a lado e grave. A imagem nunca sai do
navegador — não há upload.

**Na linha de comando.** Para lotes e para automação:

```bash
pip install -r requirements.txt
python3 aquarela.py capa.jpg --aparar
python3 aquarela.py capa.jpg --saida hero.png --papel '#fcf9ed' --ganho 1.3
```

| opção | o que faz |
|---|---|
| `--papel` | Cor do papel. Sem ela, é a mediana das bordas da imagem. |
| `--ganho` | Multiplica a cobertura. Acima de 1, tinta mais densa. |
| `--limpar` | Abaixo desta cobertura o pixel vira transparente puro. |
| `--aparar` | Corta as margens totalmente transparentes. |

## As duas fazem a mesma conta

A página não chama o Python: ela roda uma porta do algoritmo em JavaScript, para
que arrastar um controle responda na hora. Uma porta só vale se for fiel, então
há um teste que passa a mesma imagem pelas duas implementações e compara os
bytes RGBA um a um:

```bash
python3 teste/paridade.py caminho/da/imagem.png --ganho 1.6 --limpar 0.08
```

```
papel  python=[254, 247, 236]  js=[254, 247, 236]
IDENTICO: 9142272 bytes conferidos, nenhuma diferenca.
```

O teste precisa do `node` no caminho.

## O que a página tem além da conta

- **Cortina** entre o antes e o depois, arrastável.
- **Fundos de prévia**: xadrez, papel claro, fundo escuro e passe-partout. Serve
  para ver o resultado onde ele vai viver de verdade.
- **Conta-gotas do papel**, para varreduras com moldura ou sombra, onde a
  mediana das bordas erra.
- **Saturação**: separar o pigmento costuma deixar a tinta um pouco mais pálida
  do que parecia; aqui se devolve o que faltou.
- **Corte automático** na caixa do desenho, com limiar e folga. O tracejado
  mostra o que sobra, e o tamanho informado é o que o arquivo terá — medido na
  resolução cheia, não estimado na prévia.
- **Largura de saída** e **WebP**, que com transparência costuma sair em torno
  de metade do PNG.

## O limite

Aquarela sobre fundo escuro fica opaca, porque tinta translúcida precisa de
papel claro por baixo. Isso não é defeito da ferramenta, é como a tinta funciona
— e por isso a prévia oferece o passe-partout: uma folha de papel atrás da
ilustração, como uma estampa colada na página.

## Estrutura

```
aquarela.py        linha de comando
site/aquarela.js   o mesmo algoritmo, sem DOM
site/pagina.js     a interface
teste/paridade.py  prova que as duas concordam
```

## Rodar a página localmente

`site/pagina.js` é um módulo, então abrir o arquivo direto pelo `file://` não
funciona — o navegador recusa. Sirva a pasta:

```bash
python3 -m http.server -d site 8000
```
