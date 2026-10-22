# ioBroker.windhager

Lokalny adapter ioBroker dla sterowników **Windhager InfoWIN Touch / MES INFINITY**, który sam wykrywa
możliwości sterownika.

> **Status: 0.1.0 beta, repozytorium prywatne, adapter nigdy nie był uruchomiony na prawdziwym sterowniku.**
> Testy wykonano wyłącznie na syntetycznym symulatorze. Przed podłączeniem do instalacji grzewczej przeczytaj
> [DEVICE_SUPPORT.md](DEVICE_SUPPORT.md).

- **Tylko lokalnie** - HTTP(S) w sieci LAN, bez chmury i bez WindhagerConnect.
- **Domyślnie tylko odczyt.** Zapis wymaga trzech niezależnych zgód i jest potwierdzany odczytem zwrotnym.
- **Wykrywa to, co oferuje sterownik** (moduły, funkcje, punkty danych, zakresy, wyliczenia, flagi zapisu).
  Kocioł gazowy za InfoWIN Touch to instalacja autora, ale projekty źródłowe uznają obsługę gazu za niezweryfikowaną,
  więc adapter nie obiecuje niczego specyficznego dla gazu.
- TypeScript, Node.js >= 20, js-controller >= 5.0.19, Admin >= 6.17.14.

## Struktura obiektów

```
windhager.0
  info.*                         połączenie, model, wersja, ostatni odczyt, ostatni błąd
  modules.node_<n>.fn_<f>.grp_<l>.dp_<member>_<instance>
  lon.*   schedules.*   raw.*    opcjonalne, tylko odczyt
  diagnostics.*                  liczniki, opóźnienia, przycisk rescan
```

Identyfikatory powstają z numerycznych OID sterownika, nigdy z nazw wyświetlanych. Aliasy typu
`heatingCircuits.hc_1` **nie są jeszcze tworzone**, bo ich znaczenie dla urządzeń gazowych nie zostało potwierdzone.

## Instalacja (z GitHub, dopóki repozytorium jest prywatne)

```bash
cd /opt/iobroker
npm install git+ssh://git@github.com/piotr-siedlak/ioBroker.windhager.git
iobroker upload windhager
iobroker add windhager
```

## Bezpieczeństwo zapisu

1. `writesEnabled` jest **wyłączone**. Nic nie jest zapisywane przy starcie.
2. Stan jest zapisywalny tylko, gdy: zapis włączony **i** OID jest na Twojej liście dozwolonych **i** sterownik oznacza
   punkt jako zapisywalny.
3. Wartość jest walidowana (liczba, wyliczenie, min/max, krok) przed wysłaniem.
4. Sukces to dopiero potwierdzenie odczytem zwrotnym.
5. Brak zapisu surowych OID. Parametry spalania, bezpieczeństwa, serwisowe i testy elementów wykonawczych są poza zakresem.

Używaj wyłącznie do zwykłych parametrów użytkownika (temperatura zadana pomieszczenia, tryb pracy).

## Licencja i podziękowania

MIT. Wiedza o protokole pochodzi z lektury projektów społeczności (HeatNexus - GPL-3.0, kod nie został
wykorzystany; windhager-tools - MIT; ha-windhager; windhager-rest-api-documentation). Szczegóły i audyt licencji:
[RESEARCH.md](RESEARCH.md). Projekt nie jest powiązany z firmą Windhager.

Więcej: [English README](README.md) - [docs/CONFIGURATION.md](docs/CONFIGURATION.md) - [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
