/**
 * MIROX - Configurazione funzionale del modulo Call Center.
 *
 * Il client `db` viene inizializzato da ../../js/config.js, generato dalla
 * build con il progetto Supabase dell'ambiente corrente. Non inserire qui
 * URL o chiavi Supabase: causerebbero una commistione tra staging e produzione.
 */

// Google Sheet Anagrafica sync (provvisorio)
const GOOGLE_SHEET_SYNC_URL = 'https://script.google.com/macros/s/AKfycbySCJgU3GFRR57ed7oHenD50O--r3UcBTKlOp0NEB7M3ko_MDRkVtkR24o58-ZeqLnGOw/exec';

// Configurazione app
const APP_CONFIG = {
    TIMEZONE: 'Europe/Rome',
    
    // Opzioni dropdown
    COPERTURA_OPTIONS: ['FTTH', 'FWA', 'FTTC'],
    
    MOTIVO_CHIAMATA_OPTIONS: [
        'Telefono CB', 'Fisso', 'P.iva', 'Energy', 'Duferco', 'Altro'
    ],
    
    // Motivi form pubblico (sito/social)
    MOTIVO_PUBBLICO_OPTIONS: [
        'Contratti Aziendali', 'Telefonia Mobile', 'Internet Casa',
        'Luce&Gas', 'Allarmi', 'Assicurazioni'
    ],
    
    CLUSTER_OPTIONS: ['Consumer', 'Business'],
    FASCIA_OPTIONS: ['Mattina', 'Pomeriggio'],
    
    // Mappa pagine per sidebar
    PAGINE: {
        registra_chiamata:  { titolo: 'Registra chiamata', icona: 'phone-outgoing', href: 'registra-chiamata.html', gruppo: 'call-center' },
        elenco_chiamate:    { titolo: 'Elenco chiamate',   icona: 'list',           href: 'elenco-chiamate.html',   gruppo: 'call-center' },
        rilavorazione:      { titolo: 'Rilavorazione',      icona: 'refresh-cw',     href: 'rilavorazione.html',     gruppo: 'call-center' },
        call_center_lead_outbound: { titolo: 'Lead Outbound (business)', icona: 'list', href: 'call-center-lead-outbound.html', gruppo: 'call-center' },
        appuntamenti:       { titolo: 'Appuntamenti',       icona: 'calendar',       href: 'appuntamenti.html',      gruppo: 'appuntamenti' },
        prenota_interno:    { titolo: 'Nuovo appuntamento', icona: 'plus-circle',    href: 'prenota-interno.html',   gruppo: 'appuntamenti' },
        appuntamenti_oggi:  { titolo: 'Appuntamenti oggi',  icona: 'clock',          href: 'appuntamenti-oggi.html', gruppo: 'vendita' },
        esiti_appuntamenti: { titolo: 'Esiti appuntamenti', icona: 'check-circle',   href: 'esiti-appuntamenti.html',gruppo: 'call-center' },
        blacklist:          { titolo: 'Black List',         icona: 'shield-off',     href: 'blacklist.html',         gruppo: 'altro' }
    },
    
    GRUPPI_SIDEBAR: {
        'call-center':  'Call Center',
        'appuntamenti': 'Appuntamenti',
        'vendita':      'Vendita',
        'altro':        'Altro',
        'admin':        'Amministrazione'
    }
};

Object.freeze(APP_CONFIG);
