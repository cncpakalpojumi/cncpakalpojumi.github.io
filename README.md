# cncpakalpojumi.lv

Statiska mājaslapa CNC frēzēšanas pakalpojumiem Latvijā.
Tīrs HTML + CSS + vanilla JavaScript — bez frameworkiem un build rīkiem.
Paredzēta izvietošanai GitHub Pages.

## Failu struktūra

```
/
├── index.html              # Sākumlapa (one-pager ar visām sekcijām)
├── kalkulators.html        # Padziļināta kalkulatora lapa
├── portfolio.html          # Darbu portfolio
├── par-mums.html           # Par uzņēmumu
├── kontakti.html           # Kontakti un forma
├── css/
│   ├── styles.css          # Globālie stili, CSS mainīgie, reset
│   ├── components.css      # Pogas, kartītes, formas (atkārtoti lietojami)
│   └── kalkulators.css     # Kalkulatora sekcijas stili
├── js/
│   ├── main.js             # Navigācija, mobilā izvēlne, scroll animācijas, FAQ
│   └── kalkulators.js      # Cenu aprēķina loģika
├── images/                 # Vietturi reāliem foto (skat. images/README.md)
└── assets/                 # SVG ikonas
```

## Sitemap

- **/** — Sākumlapa: hero, faktu josla, materiāli, kalkulators, process, portfolio, FAQ, kontakti, footer
- **/kalkulators.html** — Padziļināta cenu kalkulatora versija
- **/portfolio.html** — Visi darbi
- **/par-mums.html** — Par uzņēmumu, iekārta, spējas
- **/kontakti.html** — Kontaktforma un informācija

## Vietējā palaišana

Nav nepieciešams build solis — atver `index.html` tieši pārlūkā,
vai izmanto jebkuru statisko serveri:

```bash
python3 -m http.server 8000
```

## Deploy (GitHub Pages)

Repo: `cncpakalpojumi/cncpakalpojumi.github.io`
Pēc push uz `main` zaru lapa būs pieejama: https://cncpakalpojumi.github.io
