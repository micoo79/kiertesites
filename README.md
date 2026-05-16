# Kiértesítés készítő (webapp)

A korábbi Tkinter alapú asztali alkalmazás böngészős változata. A Python kód
[Pyodide](https://pyodide.org/) segítségével közvetlenül a böngészőben fut, így
nem kell szerver és nem kell külön telepíteni semmit.

**Élő alkalmazás:** https://micoo79.github.io/kiertesites/

## Mit tud

- PDF vagy TXT tulajdoni lapokból kinyeri:
  - a település nevét,
  - a tulajdonosokat és vagyonkezelőket (II. rész),
  - a haszonélvezeti / tartási / özvegyi jog jogosultjait (III. rész).
- A `kiertesites4.rtf` sablont kitölti címzettenként külön oldallal.
- Postai kézbesítésnél a nyilatkozat blokk automatikusan kimarad a levélből.
- Postai kézbesítésnél `boritek.xlsx` mintából címzettenként külön munkalapot
  generál.
- Az elkészült RTF és XLSX fájlok közvetlenül letölthetők.

## Hogyan használd

1. Nyisd meg a [GitHub Pages oldalt](https://micoo79.github.io/kiertesites/).
   Az első betöltés tovább tarthat, mert a Pyodide és a Python csomagok
   (`pypdf`, `openpyxl`) töltődnek be — az állapotot a fejléc mutatja.
2. A *Sablonok* szekció alapból a repoban lévő `kiertesites4.rtf` és
   `boritek.xlsx` fájlokat használja. Ha sajátot akarsz, töltsd fel itt.
3. Tölts fel egy vagy több PDF / TXT tulajdoni lapot, majd kattints a
   **Címzettek kinyerése** gombra.
4. A *Címzettek* táblázatban közvetlenül szerkesztheted vagy törölheted az
   automatikusan kinyert sorokat, és újat is hozzáadhatsz.
5. Töltsd ki a *Kitűzés adatai* mezőket, válassz postai / személyes
   kézbesítést, majd kattints a **Generálás** gombra.
6. Az elkészült fájlok a *Elkészült fájlok* listából tölthetők le.

## Fejlesztés (lokálisan)

```bash
npm install
npm run dev
```

A `npm run build` parancs a `dist/` mappába készíti a deployolható statikus
buildet. A GitHub Actions workflow ezt automatikusan közzéteszi GitHub
Pages-en, amint a `main` (vagy a `claude/github-repo-setup-jJAR8`) branch-re
push történik.

## Felépítés

- `public/python/kiertesites_core.py` — a Python magmodul (parser, RTF/XLSX
  generálás). A Pyodide a böngészőben futtatja.
- `public/templates/` — alapértelmezett RTF és XLSX sablonok.
- `src/` — React + TypeScript frontend.
- `.github/workflows/deploy.yml` — automatikus build és Pages deploy.

## GitHub Pages bekapcsolása

A repo *Settings → Pages* menüjében válaszd a **GitHub Actions** forrást.
Ezt egyszer kell megtenni; utána minden push automatikusan deployol.
