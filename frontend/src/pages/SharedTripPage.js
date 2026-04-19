import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getSharedTrip } from "../api/trips";

export default function SharedTripPage() {
  const { token } = useParams();
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getSharedTrip(token)
      .then((data) => {
        if (!cancelled) {
          setTrip(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Roteiro não encontrado ou o link expirou.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-gray-500">Carregando roteiro...</div>
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <div className="text-6xl mb-4">🔗</div>
        <h1 className="text-2xl font-bold mb-2">Link inválido</h1>
        <p className="text-gray-500 mb-6">{error || "Não conseguimos carregar."}</p>
        <Link
          to="/"
          className="px-5 py-3 rounded-xl bg-orange-600 text-white font-semibold hover:bg-orange-700"
        >
          Ir para o Mapass
        </Link>
      </div>
    );
  }

  const days = trip.day_plans || [];

  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <div className="bg-gradient-to-br from-orange-500 to-orange-700 text-white">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <Link to="/" className="text-sm opacity-80 hover:opacity-100">
            ← Mapass
          </Link>
          <h1 className="text-4xl sm:text-5xl font-bold mt-6 leading-tight">
            {trip.name}
          </h1>
          <p className="mt-3 text-lg opacity-90">
            {trip.destination} • {trip.num_days}{" "}
            {trip.num_days === 1 ? "dia" : "dias"}
          </p>
          <div className="mt-8 flex gap-3 flex-wrap">
            <Link
              to="/login"
              className="px-5 py-3 bg-white text-orange-700 rounded-xl font-semibold hover:bg-gray-100"
            >
              Criar o meu
            </Link>
            <a
              href="https://apps.apple.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-3 bg-black/30 text-white rounded-xl font-semibold hover:bg-black/40 border border-white/20"
            >
              Baixar o app
            </a>
          </div>
        </div>
      </div>

      {/* Days */}
      <div className="max-w-3xl mx-auto px-6 py-12">
        {days.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            Este roteiro ainda não tem lugares cadastrados.
          </div>
        ) : (
          days.map((day) => (
            <section key={day.id} className="mb-12">
              <div className="flex items-baseline gap-3 mb-6">
                <h2 className="text-2xl font-bold">Dia {day.day_number}</h2>
                {day.city ? (
                  <span className="text-gray-500">• {day.city}</span>
                ) : null}
              </div>
              <div className="space-y-3">
                {(day.itinerary_items || []).map((item) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl border border-gray-200 hover:border-orange-400 transition"
                  >
                    <div className="flex gap-4">
                      <div className="w-14 text-sm font-semibold text-gray-900 pt-0.5">
                        {item.start_time
                          ? item.start_time.slice(0, 5)
                          : "—"}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">
                          {item.name}
                        </h3>
                        {item.address ? (
                          <p className="text-sm text-gray-500 mt-0.5">
                            {item.address}
                          </p>
                        ) : null}
                        {item.rating ? (
                          <p className="text-sm text-amber-600 mt-1">
                            ★ {Number(item.rating).toFixed(1)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {/* CTA footer */}
      <div className="bg-gray-50 border-t border-gray-200">
        <div className="max-w-3xl mx-auto px-6 py-10 text-center">
          <h3 className="text-2xl font-bold mb-2">
            Curtiu esse roteiro?
          </h3>
          <p className="text-gray-600 mb-6">
            Crie o seu em menos de 1 minuto. Grátis.
          </p>
          <Link
            to="/login"
            className="inline-block px-6 py-3 bg-orange-600 text-white rounded-xl font-semibold hover:bg-orange-700"
          >
            Começar agora
          </Link>
        </div>
      </div>
    </div>
  );
}
