; Installer unico: installa Trade Logger e Journal uno dopo l'altro (in silenzio) e prepara l'indirizzo degli aggiornamenti.
; Valori passati dal workflow con -D: BAR, JOURNAL (percorsi dei due installer), OUT (file da creare), URL (indirizzo aggiornamenti), VER.
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
Name "Trade Logger + Journal"
OutFile "${OUT}"
RequestExecutionLevel user
InstallDir "$TEMP\TradeLoggerSetup"
BrandingText "Trade Logger + Journal ${VER}"
ShowInstDetails show
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_FINISHPAGE_TEXT "Trade Logger e Journal sono installati.$\r$\n$\r$\nTrovi i collegamenti sul desktop e nel menu Start. Al primo avvio la barra ti guida nella configurazione."
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Italian"

Section "Installa"
  SetOutPath "$PLUGINSDIR"
  DetailPrint "Installo Trade Logger…"
  File "/oname=bar.exe" "${BAR}"
  ExecWait '"$PLUGINSDIR\bar.exe" /S' $0
  DetailPrint "Trade Logger: codice $0"
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "L'installazione di Trade Logger non è riuscita (codice $0)."
    Abort
  ${EndIf}
  Delete "$PLUGINSDIR\bar.exe"

  DetailPrint "Installo Journal…"
  File "/oname=journal.exe" "${JOURNAL}"
  ExecWait '"$PLUGINSDIR\journal.exe" /S' $0
  DetailPrint "Journal: codice $0"
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "L'installazione di Journal non è riuscita (codice $0)."
    Abort
  ${EndIf}
  Delete "$PLUGINSDIR\journal.exe"

  ; indirizzo degli aggiornamenti: lo scrivo solo se non c'è già (non tocco quello che hai impostato tu)
  CreateDirectory "$DOCUMENTS\TradeLogger"
  ${IfNot} ${FileExists} "$DOCUMENTS\TradeLogger\aggiornamenti.json"
    FileOpen $1 "$DOCUMENTS\TradeLogger\aggiornamenti.json" w
    FileWrite $1 '{"url": "${URL}"}'
    FileClose $1
    DetailPrint "Aggiornamenti automatici configurati."
  ${EndIf}
SectionEnd
