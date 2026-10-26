# cncpakalpojumi.lv

Statiska mājaslapa CNC frēzēšanas pakalpojumiem Latvijā.
Tīrs HTML + CSS + vanilla JavaScript — bez frameworkiem un build rīkiem.
Paredzēta izvietošanai GitHub Pages.

## Failu struktūra

```
/
├── index.html              # Sākumlapa (one-pager ar visām sekcijām)
├── pakalpojumi/index.html  # Pakalpojumi, materiāli, iekārta, nosacījumi
├── kalkulators/index.html  # Padziļināta kalkulatora lapa
├── par-mums/index.html     # Par uzņēmumu
├── kontakti/index.html     # Kontakti un forma
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

- **/** — Sākumlapa: hero, pakalpojumu kopsavilkums, faktu josla, kalkulators, process, FAQ, kontakti, footer
- **/pakalpojumi/** — Apstrādes veidi, materiāli, iekārta, pasūtījuma nosacījumi
- **/kalkulators/** — Padziļināta cenu kalkulatora versija
- **/par-mums/** — Par uzņēmumu, iekārta, spējas
- **/kontakti/** — Kontaktforma un informācija

## Vietējā palaišana

Nav nepieciešams build solis — atver `index.html` tieši pārlūkā,
vai izmanto jebkuru statisko serveri:

```bash
python3 -m http.server 8000
```

## Deploy (GitHub Pages)

Repo: `cncpakalpojumi/cncpakalpojumi.github.io`
Pēc push uz `main` zaru lapa būs pieejama: https://cncpakalpojumi.github.io
