'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
test('Nodemailer aggiornato: autenticazione, destinatari e MIME su SMTP locale senza consegne esterne',async()=>{
 const recipients=[],message=[],sockets=new Set();let authenticated=false;
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.setEncoding('utf8');socket.write('220 fixture ESMTP\r\n');let buffer='',body=false;
  socket.on('data',part=>{buffer+=part;let end;while((end=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
   if(body){if(line==='.'){body=false;socket.write('250 accepted\r\n');}else message.push(line);continue;}
   if(/^EHLO/.test(line))socket.write('250-fixture\r\n250 AUTH PLAIN\r\n');
   else if(/^AUTH PLAIN/.test(line)){authenticated=true;socket.write('235 authenticated\r\n');}
   else if(/^MAIL FROM/.test(line))socket.write('250 sender\r\n');
   else if(/^RCPT TO/.test(line)){recipients.push(line);socket.write('250 recipient\r\n');}
   else if(line==='DATA'){body=true;socket.write('354 continue\r\n');}
   else if(line==='QUIT'){socket.write('221 bye\r\n');socket.end();}
  }});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const transport=require('nodemailer').createTransport({host:'127.0.0.1',port:server.address().port,secure:false,ignoreTLS:true,auth:{user:'fixture',pass:'synthetic'},connectionTimeout:1500,socketTimeout:1500});
 try{
  const to=['mirko.piasenti@gmail.com','mirko.piasenti@mail.com'];const info=await transport.sendMail({from:'Mirox QA <fixture@example.invalid>',to,subject:'Promemoria Reload e Professional Cloud',html:'<p>Contratto sintetico di prova</p>'});
  assert.equal(authenticated,true);assert.deepEqual(info.accepted,to);assert.equal(recipients.length,2);assert.match(message.join('\n'),/Promemoria Reload/);assert.match(message.join('\n'),/text\/html/);
 }finally{transport.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
});
test('fflate aggiornato mantiene ZIP UTF8 e byte degli export senza alterazioni',()=>{
 const {zipSync,unzipSync,strToU8,strFromU8}=require('fflate');const input={'dati.xml':strToU8('nome e scadenza: è un test'),'cartella/vuoto.txt':new Uint8Array()};const output=unzipSync(zipSync(input));
 assert.equal(strFromU8(output['dati.xml']),'nome e scadenza: è un test');assert.deepEqual(output['cartella/vuoto.txt'],input['cartella/vuoto.txt']);
});
