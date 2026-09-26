# Tabù

Un gioco di parole a squadre in stile Taboo, fatto per GitHub Pages: niente server, niente build, solo file statici.
Dentro ci sono **1.493 carte originali in italiano** divise in 20 categorie, e si può giocare in due modi:

- **Con un telefono**: chi spiega tiene il telefono e ve lo passate a ogni turno.
- **Online**: una persona crea una stanza, gli altri entrano con un codice di 4 lettere dal proprio telefono. Chi spiega vede la carta, la sua squadra vede «Indovina!», le altre squadre vedono la carta con il pulsante Tabù!.

## Metterlo online su GitHub Pages

1. Crea un nuovo repository **pubblico**, per esempio `taboo`.
2. Carica **tutti i file di questa cartella** nella radice del repository (*Add file → Upload files*, poi *Commit changes*).
3. Vai in *Settings → Pages*. In *Build and deployment* scegli *Deploy from a branch*, branch `main`, cartella `/ (root)`, e salva.
4. Dopo un paio di minuti il gioco è su `https://TUO-UTENTE.github.io/taboo/`.

Da telefono il gioco si può anche aggiungere alla schermata Home: si apre a schermo intero e la modalità con un telefono funziona pure offline.

## Regole in breve

Chi spiega deve far dire la parola in cima alla carta senza pronunciare né la parola né le cinque parole vietate (e nemmeno pezzi di esse). Niente gesti, rime o traduzioni.
Parola indovinata +1, tabù −1, salto gratis (tutto regolabile). Alla fine di ogni turno si controlla l'elenco e si può correggere una carta toccandola.
Durata del turno, numero di turni, salti, penalità e categorie si scelgono prima di iniziare. Si possono anche aggiungere carte personalizzate direttamente dal gioco.

Da tastiera: freccia destra = Giusto!, freccia sinistra = Salta, freccia giù = Tabù!, P = pausa. Sul telefono si può anche trascinare la carta a destra o a sinistra.

## Modificare le carte

Le carte sono in `cards.js`, una per riga:

```js
["food", "Pizza", "mozzarella", "forno", "Napoli", "margherita", "fetta"],
```

cioè `[categoria, parola, 5 parole vietate]`. Le categorie sono elencate in cima al file: se ne aggiungi una nuova, aggiungila anche lì.

## Come funziona il gioco online

Il telefono di chi crea la stanza tiene la partita; gli altri si collegano direttamente a lui con WebRTC tramite [PeerJS](https://peerjs.com).
Per trovarsi i telefoni usano il server pubblico gratuito di PeerJS (0.peerjs.com): la partita non passa da nessun server di questo sito.

- Chi crea la stanza deve tenere la pagina aperta. Se la ricarica, la stanza riparte con lo stesso codice e gli altri si ricollegano da soli.
- Chi perde la connessione rientra da solo nella stessa squadra.
- Se un giorno il server pubblico non funziona, puoi usarne uno tuo ([PeerServer](https://github.com/peers/peerjs-server)) aggiungendo `?peer=tuoserver.it:443` all'indirizzo.

## File

| File | Cosa contiene |
| --- | --- |
| `index.html` | la pagina |
| `style.css` | la grafica |
| `app.js` | il gioco |
| `cards.js` | il mazzo di carte |
| `peerjs.min.js` | la libreria per il gioco online (si carica solo quando serve) |
| `anybody.woff2`, `anybody-OFL.txt` | il carattere tipografico e la sua licenza |
| `sw.js`, `manifest.webmanifest`, icone | installazione sul telefono e uso offline |

## Crediti

- Carattere **Anybody**, SIL Open Font License 1.1 (vedi `anybody-OFL.txt`).
- **PeerJS** 1.5.5, licenza MIT.
- Carte, grafica e codice scritti apposta per questo progetto.
