export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  const trains = [
    { num: "9600", label: "FR 9600", expectedOrigin: "ROMA" },
    { num: "505", label: "IC 505", expectedOrigin: "NAPOLI" },
    { num: "2843", label: "RV 2843", expectedOrigin: "BARI" },
    { num: "9810", label: "FR 9810", expectedOrigin: "VENEZIA" },
    { num: "3042", label: "R 3042", expectedOrigin: "PALERMO" },
    { num: "723", label: "IC 723", expectedOrigin: "MILANO" }
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

  if (response.status === 204) {
    return null;
  }

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

function chooseBestCandidate(lines, expectedOrigin) {
  const parsed = lines
    .map(parseAutocompleteLine)
    .filter(Boolean);

  const strong = parsed.find((item) =>
    item.rawLeft.toUpperCase().includes(expectedOrigin.toUpperCase())
  );

  return strong || parsed[0] || null;
}

function pickLastKnownStop(fermate) {
  if (!Array.isArray(fermate) || fermate.length === 0) return null;

  const passed = fermate.filter((f) => {
    return (
      f?.partenzaReale ||
      f?.arrivoReale ||
      f?.programmata === false ||
      f?.effettuata
    );
  });

  return passed[passed.length - 1] || fermate[0] || null;
}

function normalizeTrainData(config, andamento) {
  if (!andamento) {
    return {
      number: config.label,
      live: false,
      delayMinutes: null,
      statusText: "Dati non disponibili",
      origin: null,
      destination: null,
      lastStop: null,
      updatedLabel: "N/D"
    };
  }

  const fermate = andamento.fermate || [];
  const lastStop = pickLastKnownStop(fermate);

  const origin = fermate[0]?.stazione || andamento.orarioPartenza || null;
  const destination = fermate[fermate.length - 1]?.stazione || null;

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

  const lastStopName =
    lastStop?.stazione ||
    lastStop?.id ||
    null;

  return {
    number: config.label,
    live: true,
    delayMinutes: delay,
    statusText,
    origin,
    destination,
    lastStop: lastStopName,
    updatedLabel: new Date().toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit"
    })
  };
}

async function fetchTrainLiveStatus(config) {
  const autoUrl =
    `http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/cercaNumeroTrenoTrenoAutocomplete/${encodeURIComponent(config.num)}`;

  const autoText = await fetchText(autoUrl);
  const lines = autoText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const candidate = chooseBestCandidate(lines, config.expectedOrigin);

  if (!candidate) {
    return {
      number: config.label,
      live: false,
      delayMinutes: null,
      statusText: "Treno non trovato",
      origin: null,
      destination: null,
      lastStop: null,
      updatedLabel: "N/D"
    };
  }

  const andamentoUrl =
    `http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/andamentoTreno/${candidate.stationCode}/${candidate.trainNumber}/${candidate.departureTs}`;

  const andamento = await fetchJson(andamentoUrl);
  return normalizeTrainData(config, andamento);
}
