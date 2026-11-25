// Konfigurace Firebase projektu.
// Hodnoty najdete ve Firebase konzoli: Project settings → General → Your apps → Web app.
// Tyto údaje nejsou tajné – data chrání pravidla v database.rules.json.
export const firebaseConfig = {
  apiKey: "DOPLNIT",
  authDomain: "DOPLNIT.firebaseapp.com",
  databaseURL: "https://DOPLNIT-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "DOPLNIT",
  storageBucket: "DOPLNIT.appspot.com",
  messagingSenderId: "DOPLNIT",
  appId: "DOPLNIT"
};

// Výchozí texty akce (moderátor je může změnit v Nastavení).
export const DEFAULT_EVENT = {
  kicker: "FROM LAB TO MARKET /",
  title: "BREAKFAST TALKS",
  subtitle: "Podnikavost ve zdravotnických technologiích",
  open: true
};

// Hosté z plakátu – lze nahrát jedním klikem v Nastavení moderátora.
export const POSTER_GUESTS = [
  "Mikael Kubista",
  "Lukáš Peter",
  "Lenka Šomvárska",
  "Igor Gembula",
  "Jan Mužík",
  "Ondřej Fišer"
];

// Minimální odstup mezi dvěma otázkami z jednoho zařízení (musí odpovídat pravidlům databáze).
export const POST_COOLDOWN_MS = 20000;
export const MAX_LEN = 300;
