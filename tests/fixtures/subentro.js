'use strict';
function sample(count=5) {
  return {
    tipo:'mobile_microbusiness_privato',cedente_tipo:'impresa',codice_cliente:'0000123456',
    cedente_nome:'Luca',cedente_cognome:'Esempio',cedente_codice_fiscale:'SMPLCU80A01F205Q',cedente_partita_iva:'00000000000',cedente_telefono:'3200000091',cedente_ragione_sociale:'Azienda Esempio Srl',cedente_telefono_impresa:'0442000000',
    subentrante_nome:'Giulia',subentrante_cognome:'Campione',subentrante_codice_fiscale:'CMPGLI90A41L781X',subentrante_sesso:'F',subentrante_comune_nascita:'Verona',subentrante_provincia_nascita:'VR',subentrante_data_nascita:'1990-01-01',subentrante_telefono:'3200000092',subentrante_documento_tipo:'Carta d’identità',subentrante_documento_rilascio:'2024-06-15',subentrante_documento_numero:'CA00000AA',subentrante_nazionalita:'Italiana',subentrante_via:'Via della Prova',subentrante_civico:'12',subentrante_localita:'Centro',subentrante_cap:'37045',subentrante_comune:'Legnago',subentrante_provincia:'VR',
    numeri:Array.from({length:count},(_,i)=>`320${String(i+1).padStart(7,'0')}`),pagamento:'iban',banca:'Banca Esempio',iban:'IT60X0542811101000000123456',
    sottoscrittore_nome:'Giulia',sottoscrittore_cognome:'Campione',sottoscrittore_via:'Via della Prova',sottoscrittore_civico:'12',sottoscrittore_cap:'37045',sottoscrittore_comune:'Legnago',sottoscrittore_provincia:'VR',sottoscrittore_codice_fiscale:'CMPGLI90A41L781X',sottoscrittore_telefono:'3200000092',
    conto_intestatario:'Giulia Campione',conto_via:'Via della Prova',conto_civico:'12',conto_cap:'37045',conto_comune:'Legnago',conto_provincia:'VR',conto_cf_piva:'CMPGLI90A41L781X',
    consensi:{windtre:true,terze_parti:false,profilazione:true,geolocalizzazione:false,arricchimento:false,trasferimento:false},luogo:'Legnago',data:'2026-10-18'
  };
}
module.exports={sample};
