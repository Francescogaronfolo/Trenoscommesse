export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  const trains = [
    { label: "FR 9600", statusText: "Non disponibile", delayMinutes: null, lastStop: "—" },
    { label: "IC 505", statusText: "Non disponibile", delayMinutes: null, lastStop: "—" },
    { label: "RV 2843", statusText: "Non disponibile", delayMinutes: null, lastStop: "—" },
    { label: "FR 9810", statusText: "Non disponibile", delayMinutes: null, lastStop: "—" },
    { label: "R 3042", statusText: "Non disponibile", delayMinutes: null, lastStop: "—" },
    { label: "IC 723", statusText: "Non disponibile", delayMinutes: null, lastStop: "—" }
  ];

  res.status(200).json({
    ok: true,
    updatedAt: new Date().toISOString(),
    trains: trains.map((t) => ({
      number: t.label,
      live: false,
      delayMinutes: t.delayMinutes,
      statusText: t.statusText,
      lastStop: t.lastStop,
      updatedLabel: new Date().toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit"
      })
    }))
  });
}
