import React from "react";
import { Link } from "react-router-dom";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link to="/" className="text-orange-600 hover:underline text-sm">
          ← Voltar
        </Link>
        <h1 className="text-4xl font-bold mt-6 mb-2">Política de Privacidade</h1>
        <p className="text-gray-500 text-sm mb-10">
          Última atualização: 18 de abril de 2026
        </p>

        <div className="prose prose-gray max-w-none space-y-6">
          <section>
            <h2 className="text-2xl font-semibold mb-2">1. Quem somos</h2>
            <p>
              Mapass é um aplicativo de planejamento de viagens com inteligência
              artificial. Esta política descreve como coletamos, usamos e
              protegemos suas informações quando você usa nosso aplicativo e
              website.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">2. Dados que coletamos</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <strong>Conta:</strong> email, nome e foto de perfil (quando
                você entra com Apple ou Google).
              </li>
              <li>
                <strong>Roteiros:</strong> destinos, datas, lugares salvos e
                notas que você adiciona.
              </li>
              <li>
                <strong>Links analisados:</strong> URLs de vídeos do TikTok,
                Instagram ou YouTube que você cola para análise.
              </li>
              <li>
                <strong>Dados técnicos:</strong> tipo de dispositivo, sistema
                operacional e erros (para melhorar o app).
              </li>
              <li>
                <strong>Localização (opcional):</strong> apenas quando você
                autoriza, para sugerir lugares próximos.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">3. Como usamos</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Gerar e personalizar seus roteiros.</li>
              <li>
                Enviar dados para provedores de IA (Anthropic Claude) e mapas
                (Google Places) para funcionalidades do app.
              </li>
              <li>Melhorar o produto e corrigir problemas.</li>
              <li>
                Processar assinaturas por meio da App Store (Apple) e RevenueCat.
              </li>
            </ul>
            <p className="mt-3">
              <strong>Não vendemos seus dados.</strong> Não enviamos seu email
              para listas de marketing de terceiros.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">4. Terceiros que processam dados</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <strong>Supabase:</strong> autenticação e banco de dados.
              </li>
              <li>
                <strong>Anthropic:</strong> geração de roteiros com IA.
              </li>
              <li>
                <strong>Google Maps / Places:</strong> dados de lugares.
              </li>
              <li>
                <strong>Apple / Google:</strong> login social, pagamentos (IAP).
              </li>
              <li>
                <strong>RevenueCat:</strong> gerenciamento de assinaturas.
              </li>
              <li>
                <strong>Render:</strong> hospedagem dos nossos serviços.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">5. Seus direitos</h2>
            <p>
              A qualquer momento você pode:
            </p>
            <ul className="list-disc list-inside space-y-2">
              <li>Acessar, editar ou exportar seus roteiros pelo app.</li>
              <li>
                <strong>Deletar sua conta permanentemente</strong> em Perfil →
                Deletar minha conta. Isso apaga todos os seus dados em até 30
                dias.
              </li>
              <li>
                Escrever para{" "}
                <a
                  href="mailto:suporte@mapass.app"
                  className="text-orange-600 hover:underline"
                >
                  suporte@mapass.app
                </a>{" "}
                pedindo cópia ou exclusão dos dados (LGPD / GDPR).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">6. Crianças</h2>
            <p>
              O Mapass não se destina a menores de 13 anos. Se você tem menos
              de 13 anos, não use o aplicativo.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">7. Mudanças nesta política</h2>
            <p>
              Podemos atualizar esta política ocasionalmente. A data no topo
              indica a última revisão. Mudanças significativas serão
              comunicadas por email ou aviso no app.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">8. Contato</h2>
            <p>
              Dúvidas?{" "}
              <a
                href="mailto:suporte@mapass.app"
                className="text-orange-600 hover:underline"
              >
                suporte@mapass.app
              </a>
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-gray-200 flex justify-between text-sm text-gray-500">
          <Link to="/terms" className="hover:text-orange-600">
            Termos de Uso
          </Link>
          <Link to="/" className="hover:text-orange-600">
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}
