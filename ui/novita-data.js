// Elenco delle novità, dalla più recente. Per ogni nuova versione aggiungi una voce in cima.
window.NOVITA = [
  { v: '0.15.6', titolo: 'Replay dei trade (beta) e pallino', righe: [
    ['Nuovo', 'Replay (beta): se lo attivi (menu della barra o Impostazioni), mentre un trade è aperto la barra salva ogni pochi secondi un fotogramma del grafico. Nel Journal, aprendo il trade, il tasto Replay li fa scorrere dall\'apertura alla chiusura. Vale per i trade aperti da ora in poi.'],
    ['Nuovo', 'Il pallino della barra è verde quando c\'è un trade aperto e arancione quando non ce ne sono. Lo stato della copia online resta nel suggerimento che appare passandoci sopra.'],
    ['Corretto', 'Nella finestra "Copia sul PC" i pulsanti Apertura e Chiusura ora aprono davvero lo screenshot del trade.'] ] },
  { v: '0.15.4', titolo: 'Finestre come prima', righe: [
    ['Corretto', 'Ripristinato l\'aspetto della finestra di controllo del trade (apertura e chiusura): stessi colori e stessa disposizione di sempre.'] ] },
  { v: '0.15.3', titolo: 'Aggiornamenti senza impostazioni', righe: [
    ['Nuovo', 'L\'indirizzo degli aggiornamenti è già dentro la barra e il Journal: non devi più inserirlo. Entrambi controllano da soli all\'avvio. In Impostazioni resta il campo, solo per chi pubblica le versioni altrove.'] ] },
  { v: '0.15.2', titolo: 'Mac: un solo file e anche Intel', righe: [
    ['Nuovo', 'Per Mac c\'è un unico file (Trade-Logger-Journal-Mac-arm64.dmg per i chip Apple, Trade-Logger-Journal-Mac-x64.dmg per i Mac Intel): lo apri e trascini le due app nella cartella Applicazioni.'],
    ['Corretto', 'Nella release mancavano i file per i Mac Intel: ora ci sono.'] ] },
  { v: '0.15.1', titolo: 'Versione per Mac', righe: [
    ['Nuovo', 'Ogni release ora include anche i file per Mac (Trade Logger e Journal, per chip Apple e Intel). Su Mac non è firmata: la prima volta si apre con clic destro, Apri, e la barra chiede il permesso di Registrazione schermo. Gli aggiornamenti su Mac non sono automatici: si scarica la versione nuova.'] ] },
  { v: '0.15.0', titolo: 'Tutorial aggiornato', righe: [
    ['Nuovo', 'Il giro guidato nella barra ora spiega anche il salvataggio rapido, la configurazione guidata, la calibrazione automatica, le finestre affiancate, le impostazioni Base/Avanzate e gli aggiornamenti.'] ] },
  { v: '0.14.9', titolo: 'Installer unico', righe: [
    ['Nuovo', 'Da questa versione, tra i file della release c\'è anche Trade-Logger-Journal-Setup.exe: un solo file che installa insieme barra e Journal e imposta già gli aggiornamenti automatici.'] ] },
  { v: '0.14.8', titolo: 'Impostazioni più semplici', righe: [
    ['Nuovo', 'Le impostazioni mostrano in alto solo l\'essenziale (conto, piattaforma e calibrazione, barra, conferma dei trade). Layout, scorciatoie, cartella screenshot, aggiornamenti e condivisione locale sono nella sezione "Avanzate", che resta aperta o chiusa come l\'hai lasciata.'] ] },
  { v: '0.14.7', titolo: 'Finestre affiancate più precise', righe: [
    ['Corretto', 'Se una cifra di TP o SL viene letta male (es. 9 al posto di 5) ma l\'importo in dollari non torna, il programma ricava il prezzo giusto dall\'importo, lo corregge e ti avvisa di controllare.'],
    ['Corretto', 'Con le finestre ridimensionate la data del replay viene cercata anche nell\'etichetta colorata sotto il grafico, ovunque si sia spostata.'] ] },
  { v: '0.14.6', titolo: 'Calibrazione automatica: riga della data', righe: [
    ['Corretto', 'La riga della data sotto il grafico ora viene trovata anche quando gli orari si leggono male; se proprio non si leggono, viene stimata sotto il grafico e ti avvisa di controllarla.'] ] },
  { v: '0.14.5', titolo: 'Tempo per mettere il mouse sul grafico', righe: [
    ['Nuovo', 'Prima di fotografare lo schermo per la calibrazione c\'è un conto alla rovescia (6 secondi, 10 a schermo intero) in una finestrella: serve a mettere il mouse sul grafico, così sotto il grafico compare la data. Il mouse passa attraverso la finestrella, quindi non devi fare altro.'] ] },
  { v: '0.14.4', titolo: 'Calibrazione più sicura', righe: [
    ['Corretto', 'La finestra di calibrazione non va più a schermo intero vero (su alcuni PC copriva tutto e non si poteva cliccare): ora è una normale finestra ingrandita, con la barra del titolo.'],
    ['Nuovo', 'Premendo Esc si chiude sempre la calibrazione.'],
    ['Corretto', 'Con più monitor la calibrazione fotografa lo schermo dove si trova la barra (lo stesso che legge quando registri un trade), non quello salvato la volta scorsa, e la finestra si apre su quello.'],
    ['Corretto', 'Lo screenshot nella calibrazione si adatta alla finestra anche se questa cambia misura appena si apre.'] ] },
  { v: '0.14.1', titolo: 'Calibrazione automatica: si vede che sta lavorando', righe: [
    ['Nuovo', 'Mentre legge lo schermo compare una rotellina con i secondi che passano, così si capisce che non è bloccata.'] ] },
  { v: '0.14.0', titolo: 'Calibrazione automatica', righe: [
    ['Nuovo', 'Premi "Calibra in automatico": la barra trova da sola la colonna dei prezzi, il saldo, l\'orologio del replay e la riga della data. Ti mostra i riquadri trovati e tu confermi. Serve un trade aperto con TP e SL visibili.'],
    ['Nuovo', 'Se qualcosa non viene trovato, completi a mano solo quello che manca, oppure disegni tutto come prima.'] ] },
  { v: '0.13.0', titolo: 'Novità dopo ogni aggiornamento', righe: [
    ['Nuovo', 'Dopo un aggiornamento compare questa finestra con cosa è cambiato. La riapri quando vuoi dal menu, voce "Novità di questa versione".'] ] },
  { v: '0.12.4', titolo: 'Calibrazione a tutto schermo', righe: [
    ['Nuovo', 'La pagina di calibrazione occupa tutto lo schermo: niente più barre di scorrimento.'],
    ['Nuovo', 'I passi stanno in una finestrella che puoi trascinare dove vuoi.'] ] },
  { v: '0.12.3', titolo: 'Finestre affiancate più affidabili', righe: [
    ['Corretto', 'Con due grafici affiancati, spostando molto il divisore la colonna dei prezzi non veniva più letta. Ora viene ritrovata da sola, anche per spostamenti grandi.'],
    ['Corretto', 'Linee tratteggiate e riquadri degli ordini non vengono più scambiati per le etichette dei prezzi.'] ] },
  { v: '0.12.1', titolo: 'Finestre affiancate e data del replay', righe: [
    ['Corretto', 'Se sposti il divisore tra i due grafici, la colonna dei prezzi viene cercata sullo schermo e la calibrazione non si perde.'],
    ['Corretto', 'La riga con la data del replay, quando si allunga, viene letta anche fuori dal rettangolo calibrato.'] ] },
  { v: '0.12.0', titolo: 'Più pratico: meno clic, più automatico', righe: [
    ['Nuovo', 'Salva subito, senza finestra di conferma, se la lettura è completa e sicura. Se qualcosa non torna, ti chiede conferma come prima. Lo attivi o disattivi nelle Impostazioni.'],
    ['Nuovo', 'Configurazione guidata al primo avvio: piattaforma, calibrazione, tasti (F1 apre, F2 TP, F3 SL, F4 a mano), tipo di barra. La riapri dal menu.'],
    ['Nuovo', 'Gli aggiornamenti escono da soli quando cambia il numero di versione.'] ] },
  { v: '0.11.0', titolo: 'Tutorial guidato', righe: [
    ['Nuovo', 'Giro guidato della barra con nuvolette: parte la prima volta e lo riapri dal menu, voce Tutorial.'] ] },
];
