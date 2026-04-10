export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  const trains = [
    { num: "9600", label: "FR 9600", expectedOrigin: "ROMA", expectedDestination: "MILANO" },
    { num: "505", label: "IC 505", expectedOrigin: "NAPOLI", expectedDestination: "TORINO" },
    { num: "2843", label: "RV 2843", expectedOrigin: "BARI", expectedDestination: "TARANTO" },
    { num: "9810", label: "FR 9810", expectedOrigin: "VENEZIA", expectedDestination: "ROMA" },
    { num: "3042", label: "R 3042", expectedOrigin: "PALERMO", expectedDestination: "MESSINA" },
    { num: "723", label: "IC 723", expectedOrigin: "MILANO", expectedDestination: "LECCE" }
  ];

  try {
    const results = await Promise.all(trains.map(fetchTrainLiveStatus));
    res.status(200).json({
      ok: true,
      updatedAt: new Date().toISOString(),
      trains: results
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Impossibile recuperare i dati live",
      details: String(error?.message || error)
    });
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 TrenoScommesse"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} su ${url}`);
  }

  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 TrenoScommesse"
    }
  });

  if (response.status === 204) return null;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} su ${url}`);
  }

  return response.json();
}

function parseAutocompleteLine(line) {
  const parts = line.split("|");
  if (parts.length !== 2) return null;

  const left = parts[0].trim();
  const right = parts[1].trim();

  const rightMatch = right.match(/^(\d+)-([A-Z]\d+)-(\d+)$/);
  if (!rightMatch) return null;

  const [, trainNumber, stationCode, departureTs] = rightMatch;

  return {
    rawLeft: left,
    trainNumber,
    stationCode,
    departureTs
  };
}

function scoreCandidate(item, config) {
  const text = item.rawLeft.toUpperCase();
  let score = 0;

  if (text.includes(config.expectedOrigin.toUpperCase())) score += 5;
  if (text.includes(config.expectedDestination.toUpperCase())) score += 5;
  if (text.includes(config.trainTypeToken)) score += 2;

  return score;
}

function getTrainTypeToken(label) {
  if (label.startsWith("FR")) return "FRECCI";
  if (label.startsWith("IC")) return "INTERCITY";
  if (label.startsWith("RV")) return "REGIONALE";
  if (label.startsWith("R ")) return "REGIONALE";
  return "";
}

function chooseBestCandidate(lines, config) {
  const parsed = lines.map(parseAutocompleteLine).filter(Boolean);
  if (!parsed.length) return null;

  const scored = parsed
    .map((item) => ({
      item,
      score: scoreCandidate(item, config)
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 5) return null;

  return best.item;
}

function pickLastKnownStop(fermate) {
  if (!Array.isArray(fermate) || !fermate.length) return null;

  const passed = fermate.filter((f) => {
    return (
      f?.partenzaReale ||
      f?.arrivoReale ||
      f?.effettuata ||
      f?.programmata === false
    );
  });

  return passed[passed.length - 1] || fermate[0] || null;
}

function isCredibleRoute(andamento, config) {
  const fermate = andamento?.fermate || [];
  if (!fermate.length) return false;

  const firstStop = (fermate[0]?.stazione || "").toUpperCase();
  const lastStop = (fermate[fermate.length - 1]?.stazione || "").toUpperCase();

  const originOk = firstStop.includes(config.expectedOrigin.toUpperCase());
  const destinationOk = lastStop.includes(config.expectedDestination.toUpperCase());

  return originOk || destinationOk;
}

function normalizeTrainData(config, andamento) {
  if (!andamento) {
    return unavailable(config.label, "Dati non disponibili");
  }

  if (!isCredibleRoute(andamento, config)) {
    return unavailable(config.label, "Corsa non verificata");
  }

  const fermate = andamento.fermate || [];
  const lastStop = pickLastKnownStop(fermate);

  const delay =
    andamento.ritardo != null
      ? Number(andamento.ritardo)
      : lastStop?.ritardo != null
      ? Number(lastStop.ritardo)
      : null;

  let statusText = "In viaggio";
  if (andamento.cancellato) statusText = "Cancellato";
  else if (delay === 0) statusText = "Puntuale";
  else if (typeof delay === "number" && delay > 0) statusText = `Ritardo ${delay} min`;

  return {
    number: config.label,
    live: true,
    delayMinutes: delay,
    statusText,
    origin: fermate[0]?.stazione || null,
    destination: fermate[fermate.length - 1]?.stazione || null,
    lastStop: lastStop?.stazione || null,
    updatedLabel: new Date().toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit"
    })
  };
}

function unavailable(label, text) {
  return {
    number: label,
    live: false,
    delayMinutes: null,
    statusText: text,
    origin: null,
    destination: null,
    lastStop: null,
    updatedLabel: "N/D"
  };
}

async function fetchTrainLiveStatus(configBase) {
  const config = {
    ...configBase,
    trainTypeToken: getTrainTypeToken(configBase.label)
  };

  const autoUrl =
    `http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/cercaNumeroTrenoTrenoAutocomplete/${encodeURIComponent(config.num)}`;

  const autoText = await fetchText(autoUrl);
  const lines = autoText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const candidate = chooseBestCandidate(lines, config);
  if (!candidate) {
    return unavailable(config.label, "Live non disponibile");
  }

  const andamentoUrl =
    `http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/andamentoTreno/${candidate.stationCode}/${candidate.trainNumber}/${candidate.departureTs}`;

  const andamento = await fetchJson(andamentoUrl);
  return normalizeTrainData(config, andamento);
}
