# ioBroker.windhager-infotouch

Lokalny adapter ioBroker dla sterowników grzewczych **Windhager InfoWIN Touch / MES INFINITY**. Sam wykrywa, co
oferuje sterownik, i publikuje to jako stany z nazwami, jednostkami i zakresami pochodzącymi ze sterownika.
**Domyślnie tylko odczyt.**

> **Status: 0.3.0 beta, repozytorium prywatne.** Wykrywanie, nazwy, typy wartości i obiekty strukturalne zweryfikowano
> na jednym prawdziwym sterowniku (InfoWIN Touch MB6621, firmware 0.10.4, kocioł gazowy na eBUS) wyłącznie zapytaniami
> do odczytu. Długotrwałe odpytywanie na działającym ioBroker oraz **wszystkie zapisy nie były testowane na
> urządzeniu**. Przed podłączeniem do instalacji grzewczej przeczytaj [DEVICE_SUPPORT.md](DEVICE_SUPPORT.md).

## Możliwości

- **Tylko lokalnie.** HTTP(S) w sieci LAN. Bez chmury, bez WindhagerConnect, bez portów przychodzących.
- **Wykrywanie** modułów, funkcji, grup menu i punktów danych (jednostka, min/max/krok, wyliczenia, flaga zapisu),
  z pamięcią podręczną; ponowne wykrycie po zmianie modułów, firmware, języka lub opcji wykrywania.
- **Czytelne nazwy** z tabel tekstów sterownika (`/res/xml`) w języku systemu ioBroker (zapas: angielski, potem
  niemiecki), np. „Room temp. set points: Heating mode”, wartości wyliczeń jak „Stand-by”. Identyfikatory nie zależą od nazw.
- **Typy wartości:** temperatury, minuty, procenty, wyliczenia z tekstami, daty i godziny jako tekst, wersje jako
  tekst, programy czasowe jako JSON, znaczniki `-.-` jako `null`.
- **Odpytywanie** w kategoriach szybka / normalna / wolna, z wykładniczym wydłużaniem przerw, wykrywaniem braku
  łączności (flaga jakości, ostatnie wartości zostają), automatycznym powrotem i zatrzymaniem po błędzie logowania, by
  nie zablokować konta sterownika.
- **Bezpieczny zapis (opcjonalny):** dwie Twoje zgody plus flaga zapisu ze sterownika; walidacja i potwierdzenie
  odczytem zwrotnym.
- **Diagnostyka** i zanonimizowany eksport (zamaskowany host i numery seryjne, bez wartości i haseł).
- Panel w językach polskim, angielskim i niemieckim. TypeScript, Node.js >= 20, js-controller >= 5.0.19.

## Struktura obiektów

```
windhager-infotouch.0
  info.*                                     połączenie, model, wersja, ostatni odczyt, ostatni błąd
  modules.node_<n>.fn_<f>.<GG-MMM>[_<i>]     jeden stan na punkt danych, np. modules.node_15.fn_0.03-051
  lon.node_<n>.nv_<i>   raw.<key>            opcjonalne, tylko odczyt
  diagnostics.*                              liczniki, opóźnienia, przycisk rescan
```

`GG-MMM` to kod zmiennej ze sterownika (grupa-element): API zwraca go jako natywną nazwę punktu danych, a tabele tekstów
sterownika są po nim indeksowane. Pełny przykład z prawdziwej instalacji: [docs/DATAPOINTS_MB6621.md](docs/DATAPOINTS_MB6621.md).

Zakres zależy od instalacji. Kocioł gazowy na eBUS widoczny jest przez moduły regulacji i daje głównie wartości
zadane, temperatury, stany pomp/mieszacza i programy czasowe; **nie** daje modulacji palnika ani godzin pracy.
Przyjazne aliasy (`kociol`, `obiegGrzewczy`...) nie są tworzone - ich powiązanie z typami funkcji jest niezweryfikowane.

## Instalacja (z GitHub, dopóki repozytorium jest prywatne)

Host ioBroker potrzebuje klucza SSH z dostępem do repozytorium.

```bash
cd /opt/iobroker
iobroker url https://github.com/piotr-siedlak/ioBroker.windhager-infotouch
```

Katalog `build/` jest w repozytorium, więc kompilacja nie jest potrzebna. Szczegóły: [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Bezpieczeństwo zapisu

1. `writesEnabled` jest **wyłączone**. Nic nie jest zapisywane przy starcie.
2. Stan jest zapisywalny tylko, gdy: zapis włączony **i** dokładny OID jest na Twojej liście **i** sterownik oznacza
   punkt jako zapisywalny. (Na sterowniku referencyjnym 58 z 78 punktów jest oznaczonych jako zapisywalne, także
   ustawienia instalatora - sama flaga sterownika nie jest gwarancją bezpieczeństwa.)
3. Wartość jest walidowana (liczba, wyliczenie, min/max, krok); wartość poza zakresem jest odrzucana.
4. Sukces to dopiero potwierdzenie odczytem zwrotnym (do 3 odczytów).
5. Brak zapisu surowych OID. Punkty końcowe: parametry spalania, bezpieczeństwo, serwis, test elementów wykonawczych,
   użytkownicy, VPN, firmware i konfiguracja nigdy nie są wywoływane ([docs/API_REFERENCE.md](docs/API_REFERENCE.md)).

Używaj zapisu tylko do zwykłych parametrów (temperatura zadana, tryb pracy) i najpierw przetestuj jedną wartość.

## Dokumentacja i licencja

[English README](README.md) - [docs/CONFIGURATION.md](docs/CONFIGURATION.md) - [docs/STATES.md](docs/STATES.md) -
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) - [RESEARCH.md](RESEARCH.md) - [DEVICE_SUPPORT.md](DEVICE_SUPPORT.md)

MIT. Wiedza o protokole pochodzi z dokumentacji Swagger samego sterownika oraz z lektury projektów społeczności
(HeatNexus - GPL-3.0, kod nie został wykorzystany; windhager-tools - MIT; ha-windhager;
windhager-rest-api-documentation). Audyt licencji: [RESEARCH.md](RESEARCH.md). Projekt nie jest powiązany z firmą Windhager.
