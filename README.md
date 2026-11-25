# Otázky pro panelovou diskuzi

Jednoduchá webová aplikace pro anonymní otázky studentů během panelové diskuze.
Poprvé použita na akci **Breakfast Talks – From Lab to Market** (26. 11. 2026, Vector Space, NTK).

## Stránky

| Stránka | Pro koho | Co umí |
|---|---|---|
| `index.html` | studenti (z QR kódu, mobil) | položit otázku a vybrat adresáta, prohlížet a filtrovat otázky, hlasovat |
| `moderator.html` | moderátoři (PC) | všechny otázky živě, fronta s pořadím, označení „položeno“, skrytí, smazání, ovládání projekce, nastavení |
| `projekce.html` | plátno / projektor | úvod s QR kódem, aktuální otázka, nebo fronta otázek, vše řídí moderátor |

## Soukromí

- Studenti se nepřihlašují a nezadávají žádné údaje.
- Ukládá se jen text otázky, adresát, čas a hlasy.
- Každé zařízení dostane náhodný anonymní identifikátor (Firebase Anonymous Auth). Ten slouží k tomu, aby
  student nemohl hlasovat pro vlastní otázku ani dávat jedné otázce víc hlasů, a k omezení na 1 otázku za 20 s.
- Moderátor může kdykoliv smazat jednotlivé otázky nebo všechna data (Nastavení → Data → Smazat vše).

## Technologie

- Čisté HTML/CSS/JavaScript bez sestavování, hostováno na GitHub Pages.
- Data: Firebase Realtime Database (region europe-west1), přihlášení: Firebase Authentication.
- QR kódy: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), soubor `vendor/qrcode.js`.

## Nastavení (jednorázově)

1. **Firebase projekt:** console.firebase.google.com → nový projekt (bez Analytics).
2. **Authentication → Sign-in method:** zapnout *Anonymous* a *Email/Password*.
3. **Authentication → Users → Add user:** účet moderátora (sdílený), poznamenat si jeho **User UID**.
4. **Authentication → Settings → Authorized domains:** přidat `kamenvoj.github.io`.
5. **Realtime Database → Create database:** Belgium (europe-west1), *locked mode*.
6. **Realtime Database → Rules:** vložit obsah `database.rules.json`, kde `MODERATOR_UID` je nahrazené
   UID moderátora, a kliknout na *Publish*.
7. **Project settings → Your apps → Web app:** zkopírovat `firebaseConfig` do `js/firebase-config.js`.
8. **GitHub → Settings → Pages:** Source *Deploy from a branch*, branch `main`, složka `/ (root)`.

## Použití na další akci

1. V moderátorském panelu: **Nastavení → Data → Exportovat** (pokud chcete otázky uchovat), pak **Smazat vše**.
2. **Nastavení → Akce:** upravit název a podtitul.
3. **Nastavení → Komu lze otázky položit:** upravit jména.
4. Grafiku (skvrny, pozadí, loga) lze vyměnit v `assets/` a `css/brand.css`.

## Datová struktura (Realtime Database)

```
config/event        {kicker, title, subtitle, open}
config/targets/{id} {name, note?, order}
questions/{qid}     {text, target ('all' | id adresáta), createdAt, asked?, askedAt?}
authors/{qid}       uid autora (čte jen moderátor, slouží pravidlům)
votes/{qid}/{uid}   true
lastPost/{uid}      čas poslední otázky (omezení frekvence)
hidden/{qid}        skryté otázky (jen moderátor)
queue/{qid}         {order} fronta moderátora
projection          {mode: idle | question | queue | blank, current}
```
