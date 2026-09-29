import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

const contacts = read("Wordpress/kodety/includes/email/class-kodety-email-contacts.php");
const campaigns = read("Wordpress/kodety/includes/email/class-kodety-email-campaigns.php");
const queue = read("Wordpress/kodety/includes/email/class-kodety-email-queue.php");
const transport = read("Wordpress/kodety/includes/email/class-kodety-email-transport.php");
const health = read("Wordpress/kodety/includes/email/class-kodety-email-health.php");
const settings = read("Wordpress/kodety/includes/email/class-kodety-email-settings.php");
const marketing = read("Wordpress/kodety/includes/email/class-kodety-email-marketing.php");
const tracking = read("Wordpress/kodety/includes/email/class-kodety-email-tracking.php");
const bounces = read("Wordpress/kodety/includes/email/class-kodety-email-bounces.php");
const scheduler = read("Wordpress/kodety/includes/email/class-kodety-email-scheduler.php");
const schema = read("Wordpress/kodety/includes/email/class-kodety-email-schema.php");
const audienceAdmin = read("Wordpress/kodety/includes/email/class-kodety-email-admin-audience.php");
const campaignsAdmin = read("Wordpress/kodety/includes/email/class-kodety-email-admin-campaigns.php");
const templatesAdmin = read("Wordpress/kodety/includes/email/class-kodety-email-admin-templates.php");
const marketingCss = read("Wordpress/kodety/admin/email-marketing.css");
const marketingJs = read("Wordpress/kodety/admin/email-marketing.js");

assert(
  schema.includes("kodety_email_") && schema.includes("consent_events"),
  "schema deve criar trilha durável de consentimento",
);
assert(
  contacts.includes("public static function resubscribe(") &&
    contacts.includes("persist_suppression") &&
    contacts.includes("'status' => 'pending'"),
  "contatos devem exigir reinscrição explícita e sync sem consentimento deve ficar pending",
);
assert(
  marketing.includes("$consent_confirmed && $contact && (string) $contact['status'] === 'pending'") &&
    contacts.includes("AND c.status = 'pending'") &&
    contacts.includes("NOT EXISTS (") &&
    contacts.includes("Bounce e complaint exigem investigação"),
  "consentimento confirmado só pode promover pending sem suppression, nunca opt-out/bounce/complaint",
);
const csvPipeline = contacts.slice(
  contacts.indexOf("private static function import_csv_handle("),
  contacts.indexOf("// --- Supressão"),
);
assert(
  contacts.includes("private const IMPORT_CHUNK_SIZE = 250") &&
    csvPipeline.includes("self::import_csv_chunk(") &&
    csvPipeline.includes("ON DUPLICATE KEY UPDATE") &&
    csvPipeline.includes("insert_import_memberships") &&
    csvPipeline.includes("insert_import_audits") &&
    csvPipeline.includes("$locked_list") &&
    csvPipeline.includes("Kodety_Email_Schema::table('lists')") &&
    csvPipeline.includes("START TRANSACTION") &&
    csvPipeline.includes("ROLLBACK") &&
    csvPipeline.includes("COMMIT") &&
    !csvPipeline.includes("self::upsert(") &&
    !csvPipeline.includes("self::find_by_email(") &&
    !csvPipeline.includes("self::is_suppressed("),
  "CSV síncrono deve usar checkpoints transacionais e SQL em lote, sem consultas por linha",
);
assert(
  contacts.includes("public static function delete_list(int $list_id): array") &&
    contacts.includes("WHERE status IN ('draft', 'failed', 'scheduled')") &&
    contacts.includes("FOR UPDATE") &&
    contacts.includes("'reason' => 'referenced'") &&
    marketing.includes("result['campaign_count']") &&
    marketing.includes("'invalid_audience'") &&
    audienceAdmin.includes("campaign_reference_count") &&
    audienceAdmin.includes("Troque a audiência") &&
    campaigns.includes("WHERE id = %d AND status IN ('draft', 'failed')"),
  "lista referenciada deve ser bloqueada atomicamente, a UI precisa explicar o vínculo e scheduled não pode mudar de audiência",
);
assert(
    campaigns.includes("START TRANSACTION") &&
    campaigns.includes("ROLLBACK") &&
    campaigns.includes("COMMIT") &&
    campaigns.includes("private static function locked_campaign(") &&
    campaigns.includes("WHERE id = %d FOR UPDATE") &&
    !campaigns.includes("bool $allow_scheduled") &&
    !campaigns.includes("scheduled_at <= %s") &&
    campaigns.includes("$where = \"id = %d AND status IN ('draft', 'failed')\"") &&
    campaigns.includes("self::queued_audience_signature($id)"),
  "início manual deve bloquear a revisão e a fotografia exata do público sem caminho de scheduled",
);
const saveCampaignHandler = marketing.slice(
  marketing.indexOf("public function handle_save_campaign"),
  marketing.indexOf("public function handle_send_campaign"),
);
assert(
  campaignsAdmin.includes("O envio começa somente depois da confirmação manual") &&
    !campaignsAdmin.includes('name="scheduled_at"') &&
    !campaignsAdmin.includes('name="schedule_campaign"') &&
    !campaignsAdmin.includes("data-kodety-schedule-submit") &&
    !saveCampaignHandler.includes("Kodety_Email_Scheduler::schedule") &&
    !marketing.includes("add_action(Kodety_Email_Scheduler::LEGACY_CRON_HOOK") &&
    marketing.includes("public function enforce_manual_only") &&
    marketing.includes("Kodety_Email_Scheduler::cancel((int) $id)") &&
    marketing.includes("private const MANUAL_ONLY_VERSION = 2"),
  "campanhas devem ser exclusivamente manuais e migrar agendamentos legados para rascunho",
);
assert(
  campaignsAdmin.includes('data-kodety-blocked=') &&
    campaignsAdmin.includes('aria-disabled="true"') &&
    !/data-kodety-requires-saved\s*[\s\S]{0,120}<\?php disabled\(\$blocking/.test(campaignsAdmin) &&
    marketingJs.includes("var blockedReason = form.getAttribute('data-kodety-blocked')") &&
    marketingJs.includes("window.alert(blockedReason)"),
  "Enviar agora deve continuar clicável e explicar por que a validação bloqueou o disparo",
);
assert(
  campaigns.includes("campaign_snapshot") && campaigns.includes("delivery_config"),
  "campanha deve persistir snapshot efetivo de entrega",
);
assert(
  campaigns.includes("save_template_if_revision") &&
    campaigns.includes("FOR UPDATE") &&
    marketing.includes("expected_revision") &&
    marketing.includes("kodety_email_template_conflict") &&
    marketing.includes("['status' => 409]"),
  "salvamento de template deve detectar conflito entre abas e retornar HTTP 409",
);
assert(
  campaigns.includes("public static function campaign_revision(") &&
    campaigns.includes("save_draft_if_revision") &&
    campaigns.includes("stash_draft_recovery") &&
    campaigns.includes("expected_audience_signature") &&
    campaigns.includes("queued_audience_signature") &&
    marketing.includes("expected_audience_signature") &&
    campaignsAdmin.includes('name="expected_revision"') &&
    campaignsAdmin.includes('name="expected_audience_signature"'),
  "salvar, testar e enviar campanha devem rejeitar revisão ou conjunto de destinatários obsoletos",
);
assert(
  campaigns.includes("DELETE t") &&
    campaigns.includes("c.template_id = t.id") &&
    templatesAdmin.includes("usage_count") &&
    templatesAdmin.includes("Reatribua as campanhas antes de apagar"),
  "template referenciado não pode ser apagado nem deixar rascunhos sem conteúdo",
);
assert(
  !templatesAdmin.includes("kodety-builder-cta__icon") &&
    !marketingCss.includes(".kodety-builder-cta__icon"),
  "CTA do construtor não deve renderizar nem reservar espaço para o bloco decorativo",
);
assert(
  /\.kodety-builder-cta__features\s*\{[^}]*display:flex[^}]*flex-wrap:wrap/.test(marketingCss),
  "os recursos do construtor devem quebrar linha em telas estreitas sem perder conteúdo",
);
assert(
  marketing.includes("kodety_email_template_create_failed") &&
    marketing.includes("$id > 0 ? Kodety_Email_Campaigns::get_template($id) : null") &&
    marketing.includes("Seu rascunho local foi preservado.") &&
    marketing.includes("['status' => 500]"),
  "criação de template não pode confirmar sucesso nem descartar o rascunho quando o insert falha",
);
assert(
  queue.includes("completed_with_errors") &&
    queue.includes("!empty($result['suppress'])"),
  "fila deve expor falhas e respeitar classificação explícita de supressão",
);
assert(
  queue.includes("SELECT GET_LOCK(%s, 0)") &&
    queue.includes("SELECT RELEASE_LOCK(%s)") &&
    queue.includes("try {") &&
    queue.includes("finally {") &&
    queue.includes("if ($transport instanceof Kodety_Email_Transport) $transport->close();"),
  "throttle global deve serializar allowance e envio entre campanhas concorrentes",
);
assert(
  queue.includes("private static function campaign_is_sending(") &&
    queue.includes("self::release(array_slice($batch") &&
    queue.indexOf("Kodety_Email_Settings::for_campaign($campaign)") >
      queue.indexOf("if (!self::acquire_sender_lock())"),
  "worker deve revalidar pausa após o lock e antes de cada destinatário",
);
assert(
  settings.includes("_campaign_delivery_current") &&
    queue.includes("pause_for_delivery_change") &&
    campaigns.includes("delivery_configuration_changed") &&
    !campaigns.includes("Kodety_Email_Health::report(true)") &&
    campaigns.includes("Kodety_Email_Settings::campaign_snapshot($settings)"),
  "rotação do transporte deve pausar a fila para reconfirmação manual, sem transformar a saúde em bloqueio",
);
assert(
  !campaigns.includes("A entrega ainda não está pronta") &&
    !campaigns.includes("if (!$health['ready'])") &&
    health.includes("'send_allowed' => true") &&
    health.includes("'optimized' => self::is_optimized($checks)"),
  "SPF, DKIM, PTR, teste e bounce devem ser recomendações, nunca bloqueios do envio manual",
);
assert(
  queue.includes("public static function reconcile_transport_ack_failure(") &&
    queue.includes("requires_manual_reconciliation") &&
    campaigns.includes("public static function transport_ack_reconciliation(") &&
    campaigns.includes("Kodety_Email_Queue::reconcile_transport_ack_failure(") &&
    campaigns.includes("Reconcilie essa fila como entrega incerta antes de retomar") &&
    marketing.includes("'reconcile_campaign_ack'") &&
    campaignsAdmin.includes("kodety_email_reconcile_campaign_ack") &&
    campaignsAdmin.includes("Registrar entrega incerta e continuar"),
  "ACK aceito sem persistência deve bloquear resume e exigir reconciliação terminal explícita antes dos demais destinatários",
);
assert(
  settings.includes("private const SECRET_PREFIX = 'enc:v1:'") &&
    settings.includes("'aes-256-gcm'") &&
    settings.includes("private static function protect_settings(") &&
    settings.includes("private static function decrypt_secret(") &&
    settings.includes("is_wp_error($plain) ? '' : $plain") &&
    settings.includes("$protected !== $stored && !update_option(") &&
    marketing.includes("is_wp_error($saved)"),
  "segredos devem migrar para criptografia autenticada, falhar fechados e reportar erro de persistência sem quebrar saves idempotentes",
);
assert(
  scheduler.includes("public static function schedule(") &&
    scheduler.includes("self::cancel($campaign_id)") &&
    scheduler.includes("public static function dispatch(") &&
    scheduler.includes("public static function run_due(") &&
    scheduler.includes("'queued' => 0") &&
    !scheduler.includes("Kodety_Email_Queue::enqueue_campaign") &&
    !scheduler.includes("wp_schedule_single_event(") &&
    !scheduler.includes("Kodety_Email_Campaigns::send(") &&
    campaigns.includes("$row['status'] === 'scheduled'") &&
    campaigns.includes("$to_status === 'scheduled'") &&
    campaigns.includes("$field === 'scheduled_at' && $value !== null"),
  "APIs legadas devem falhar ou converter para rascunho, nunca criar ou disparar scheduled",
);
assert(
  !transport.includes("return $this->failure('smtp_' . $matches[1], $info, true);") &&
    transport.includes("5.1.1") &&
    transport.includes("'suppress' => $suppress"),
  "transporte não pode suprimir todo SMTP 5xx",
);
assert(
  transport.indexOf("$mailer->clearReplyTos();") <
    transport.indexOf("if (is_email((string) $settings['reply_to']))") &&
    transport.includes("$mailer->AltBody = '';") &&
    transport.includes("'from_email' => (string) $settings['from_email']") &&
    transport.includes("Kodety_Email_Settings::sender_domain_for($settings)") &&
    settings.includes("public static function sender_domain_for(array $settings)") &&
    settings.includes("$out['dkim_domain'] = self::sender_domain_for("),
  "reuso do PHPMailer deve limpar estado da mensagem e manter DKIM/HELO alinhados ao From efetivo",
);
assert(
  transport.includes("DNS_A") &&
    transport.includes("DNS_AAAA") &&
    transport.includes("public static function is_public_ip(") &&
    transport.includes("public array $KodetyMXEndpoints = []") &&
    transport.includes("'peer_name' => $hostname") &&
    transport.includes("'verify_peer_name' => true") &&
    !transport.includes("gethostbyname("),
  "mx_direct deve fixar IPs públicos A/AAAA e validar TLS/SNI no hostname de cada MX",
);
assert(
  marketing.includes("kodety_email_cleanup") &&
    marketing.includes("retention_days") &&
    marketing.includes("ensure_cron") &&
    marketing.includes("kodety_email_process_campaign") &&
    marketing.includes("cron_campaign_worker"),
  "retention e autorrecuperação do cron devem estar ligadas ao runtime",
);
assert(
  tracking.includes("public static function view_url(") &&
    tracking.includes("private function serve_view(") &&
    tracking.includes("Content-Security-Policy"),
  "view-in-browser precisa de endpoint assinado com isolamento de conteúdo",
);
assert(
  tracking.includes("Content-Length: ' . strlen($pixel)") &&
    !tracking.includes("Content-Length: 43"),
  "pixel de abertura deve declarar o tamanho real do GIF",
);
assert(
  tracking.includes("$_POST['List-Unsubscribe']") &&
    tracking.includes("hash_equals('One-Click'") &&
    tracking.includes("private static function is_rfc8058_one_click(") &&
    tracking.includes("if ($is_post && !$one_click)"),
  "unsubscribe POST só pode ser automático com o parâmetro exato do RFC 8058",
);
assert(
  tracking.includes("public static function record_unique(") &&
    tracking.includes("private static function record_windowed(") &&
    tracking.includes("SELECT GET_LOCK(%s, 0)") &&
    tracking.includes("AND url = %s") &&
    tracking.includes("AND occurred_at >= %s") &&
    tracking.includes("SELECT RELEASE_LOCK(%s)"),
  "tracking público deve deduplicar retries e limitar clicks por URL/janela sob lock",
);
assert(
  contacts.includes("wp_salt('kodety_email_event_deletion')") &&
    contacts.includes("SHA2(CONCAT(%s, %s, campaign_id, %s, contact_id)") &&
    contacts.includes("url = '', ip_hash = '', user_agent = ''") &&
    contacts.includes("Kodety_Email_Schema::table('consent_events')"),
  "exclusão deve anonimizar eventos, preservar distinct por surrogate e remover dados identificáveis",
);
assert(
  contacts.includes("kodety_email_unsub_") &&
    contacts.includes("$changed = $previous_reason !== $effective_reason") &&
    contacts.includes("if ($changed)") &&
    contacts.includes("SELECT RELEASE_LOCK(%s)"),
  "unsubscribe deve ser idempotente inclusive sob requests simultâneos",
);
assert(
  marketing.includes("Kodety_Email_Bounces::register_route()") &&
    bounces.includes("x-kodety-bounce-secret"),
  "webhook VERP precisa estar registrado e autenticado",
);
assert(
  bounces.includes("Kodety_Email_Contacts::suppress(") &&
    bounces.includes("Kodety_Email_Tracking::record_unique(") &&
    bounces.includes("hash_equals($expected, $provided)") &&
    settings.includes("bounce_webhook_secret"),
  "bounce e complaint assíncronos devem alimentar supressão e tracking idempotente",
);
assert(
  campaignsAdmin.includes("paginate_campaigns") &&
    campaignsAdmin.includes("campaign_overview") &&
    !campaigns.includes("ORDER BY created_at DESC LIMIT 200") &&
    templatesAdmin.includes("paginate_templates"),
  "campanhas e templates devem usar paginação server-side e KPIs globais sem carregar snapshots pesados",
);
assert(
    health.includes("public static function record_delivery_test(") &&
    health.includes("Kodety_Email_Settings::delivery_fingerprint($settings)") &&
    health.includes("private static function check_delivery_test(") &&
    health.includes("$required = ['dkim', 'test']") &&
    marketing.includes("Kodety_Email_Health::record_delivery_test("),
  "readiness deve depender de teste recente vinculado ao fingerprint da configuração real",
);
assert(
  health.includes("'SPF (análise estrutural)'") &&
    health.includes("'Saída SMTP (pré-checagem)'") &&
    health.includes("autenticação e envio ainda não foram testados"),
  "SPF heurístico, mail() e socket aberto não podem ser apresentados como prova de entrega",
);

console.log("Contratos estáticos do backend de Email Marketing aprovados.");
