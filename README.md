# KOMP – oppsett

Tar ca. 20 minutter. Alt er gratis for en familie.

## 1. Lag database i Supabase
1. Gå til supabase.com og lag en gratis konto og et nytt prosjekt (velg region **Frankfurt** eller **Stockholm**).
2. Åpne **SQL Editor → New query**, lim inn hele `supabase.sql` og trykk **Run**.
3. Gå til **Authentication → Sign In / Providers → Email** og slå **av** «Confirm email».
   Da kommer folk rett inn etter at de har laget bruker. (Lar du den stå på, må alle bekrefte via e-post først.)
4. Gå til **Authentication → URL Configuration** og sett **Site URL** til adressen appen får i steg 3 under.

## 2. Koble appen til databasen
Åpne **Project Settings → API** i Supabase og kopier **Project URL** og **anon public key** inn i `config.js`.

## 3. Legg appen ut på nett
Enklest: gå til **app.netlify.com/drop** og dra hele `komp`-mappen inn. Du får en adresse som `noe-tilfeldig.netlify.app`, som du kan gi nytt navn under Site settings (for eksempel `komp-familien.netlify.app`).
Husk å sette den adressen som Site URL i Supabase (steg 1.4).

## 4. Lag admin-brukeren din
Åpne adressen og trykk **Ny her? Lag bruker**. Bruk **fjeldsimen@gmail.com**. Feltet for invitasjonskode kan stå tomt for deg.
Du blir automatisk admin.

## 5. Inviter familien
Trykk på profilsirkelen din øverst til høyre. Under **Admin** finner du invitasjonslenken. Kopier den og send den til familien.
De som åpner lenken, lager bruker med navn, e-post og passord, og får beskjed om å legge KOMP på hjemskjermen.

Som admin kan du også:
- slette alle innlegg (søppelbøtta på innlegget)
- fjerne medlemmer, eller slippe dem inn igjen
- lage en ny lenke hvis den gamle er delt for bredt

## Godt å vite
- **Video**: maks 50 MB per video (grensen på Supabase sin gratisplan). Det tilsvarer ca. 30–60 sekunder fra en iPhone.
- **Utløpte innlegg** forsvinner fra feeden med en gang tiden er ute. Filene slettes fra lagringen neste gang du som admin åpner appen.
- **iPhone/iPad**: når KOMP er lagt på hjemskjermen, må man logge inn én gang til i appen. Det er sånn Apple gjør det.
- **Gratisplanen** gir 1 GB lagring. Med 2-dagers innlegg som standard holder det lenge.
- **Oppdatere appen**: endre filene og dra mappen inn på Netlify igjen (Deploys → dra inn ny versjon).
