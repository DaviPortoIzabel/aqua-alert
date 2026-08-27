# Firmware do Aqua Alert

O arquivo `AquaAlertESP8266/AquaAlertESP8266.ino` reune a configuracao de Wi-Fi, a chave do dispositivo e a medicao de vazao para um ESP8266 (NodeMCU).

## Antes de gravar

1. No Arduino IDE, instale a plataforma **ESP8266 by ESP8266 Community** e abra `AquaAlertESP8266.ino`.
2. Selecione a placa correspondente (por exemplo, **NodeMCU 1.0 (ESP-12E Module)**) e envie o programa.
3. Ligue o fio de sinal do YF-S201 ao pino **D2/GPIO4**, o GND do sensor ao GND do ESP e a alimentacao conforme as especificacoes do sensor. Se o sinal do sensor for 5 V, use conversor de nivel para proteger o GPIO de 3,3 V do ESP8266.

## Primeira configuracao

1. Crie a conta no site e copie a **chave de cinco digitos do ESP**.
2. Com o ESP ligado, conecte o celular ou computador na rede `AquaAlert_Config`, senha `12345678`.
3. A tela de login da rede deve abrir o portal automaticamente. Caso o celular nao a abra (essa decisao e do sistema operacional), acesse `http://192.168.4.1` no navegador.
4. Informe o nome e a senha da sua rede Wi-Fi e a chave/ID numerico de cinco digitos entregue pelo site. O dispositivo reinicia, conecta e passa a enviar leituras a cada cinco segundos.

O firmware envia os litros acumulados desde o ultimo envio confirmado para `POST /api/leituras`, com a chave no cabecalho `X-Device-Key`. Se uma tentativa falhar, o volume fica pendente para o proximo envio.

`PULSES_PER_LITER` esta configurado como 450, valor aproximado do YF-S201. Calibre esse valor com uma quantidade conhecida de agua para maior precisao.
