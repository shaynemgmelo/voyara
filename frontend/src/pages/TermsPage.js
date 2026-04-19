import React from "react";
import { Link } from "react-router-dom";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link to="/" className="text-orange-600 hover:underline text-sm">
          ← Voltar
        </Link>
        <h1 className="text-4xl font-bold mt-6 mb-2">Termos de Uso</h1>
        <p className="text-gray-500 text-sm mb-10">
          Última atualização: 18 de abril de 2026
        </p>

        <div className="prose prose-gray max-w-none space-y-6">
          <section>
            <h2 className="text-2xl font-semibold mb-2">1. Aceitação</h2>
            <p>
              Ao usar o Mapass, você concorda com estes Termos. Se não
              concordar, não use o serviço.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">2. O serviço</h2>
            <p>
              Mapass é um aplicativo que usa inteligência artificial para
              ajudar você a planejar viagens. Os roteiros gerados são
              sugestões — verifique sempre horários, endereços, disponibilidade
              e reservas antes da sua viagem.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">3. Sua conta</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>Você é responsável pelo conteúdo da sua conta.</li>
              <li>Mantenha suas credenciais seguras.</li>
              <li>
                Você pode deletar sua conta a qualquer momento pelo app.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">4. Uso aceitável</h2>
            <p>Você concorda em NÃO:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Usar o app para atividades ilegais.</li>
              <li>Tentar burlar sistemas de segurança ou pagamento.</li>
              <li>Revender acesso ao serviço sem autorização.</li>
              <li>Fazer scraping automatizado dos nossos endpoints.</li>
              <li>
                Enviar conteúdo ilegal, ofensivo ou que viole direitos autorais.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">5. Assinaturas e pagamentos</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>
                Assinaturas do Mapass Pro são processadas pela App Store
                (iOS).
              </li>
              <li>
                Renovação automática — você pode cancelar a qualquer momento
                nas configurações da sua conta Apple.
              </li>
              <li>
                Reembolsos seguem a política da Apple App Store.
              </li>
              <li>
                Valores podem mudar — quando mudarem, avisaremos com
                antecedência.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">6. Conteúdo gerado por IA</h2>
            <p>
              Os roteiros, sugestões e respostas do chat são gerados por
              inteligência artificial. Podem conter imprecisões — não
              substituem aconselhamento profissional de viagem. Verifique
              informações críticas (vistos, clima, segurança) em fontes
              oficiais.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">7. Propriedade intelectual</h2>
            <p>
              Você mantém os direitos do conteúdo que cria no app (notas,
              títulos, roteiros). O código, design e marca do Mapass são
              nossos. Não reproduza sem autorização.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">8. Links de terceiros</h2>
            <p>
              O app pode linkar para sites de terceiros (Google Maps, TikTok,
              Instagram etc.). Não somos responsáveis pelo conteúdo deles.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">9. Limitação de responsabilidade</h2>
            <p>
              O Mapass é fornecido "como está". Não garantimos que será livre
              de erros ou interrupções. Não somos responsáveis por perdas
              indiretas relacionadas ao uso do app (viagens perdidas, reservas
              incorretas etc.). Sempre confirme informações antes de tomar
              decisões importantes.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">10. Encerramento</h2>
            <p>
              Podemos suspender ou encerrar contas que violem estes Termos.
              Você pode deletar sua conta a qualquer momento pelo app.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">11. Lei aplicável</h2>
            <p>
              Estes Termos são regidos pelas leis do Brasil.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-2">12. Contato</h2>
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
          <Link to="/privacy" className="hover:text-orange-600">
            Política de Privacidade
          </Link>
          <Link to="/" className="hover:text-orange-600">
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}
