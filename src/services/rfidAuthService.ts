import { supabase } from './supabaseClient';
import { Session } from '@supabase/supabase-js';

/**
 * @file rfidAuthService.ts
 * @description Serviço de autenticação via RFID com mapeamento direto (Hardcoded) para o protótipo.
 */

export interface RFIDUser {
  id: string;
  email: string;
  full_name?: string;
}

/**
 * Tenta realizar o login no Supabase usando o UID do RFID como chave mapeada.
 */
export async function signInWithRFID(uid: string): Promise<Session | null> {
  console.log('[PetroGate RFID] Tentando identificar cartão:', uid);
  
  try {
    // SOLUÇÃO ZERO-TABELA: Mapeamento direto no código para o seu protótipo
    let email = null;
    if (uid === '1ACE847F') email = 'teste@petrobras.com.br';
    if (uid === 'BA0B9816') email = 'teste2@petrobras.com.br';
    if (uid === 'CA7E7919') email = 'teste3@petrobras.com.br'; 

    if (!email) {
      console.error('[PetroGate RFID] Cartão não mapeado no código.');
      return null;
    }

    console.log('[PetroGate RFID] Usuário identificado via código:', email);
    
    // Mapeamento de senhas específicas
    let passwordToUse = 'PetroGate2026'; 
    if (email === 'teste@petrobras.com.br') passwordToUse = 'teste';
    if (email === 'teste2@petrobras.com.br') passwordToUse = 'Teste';
    if (email === 'teste3@petrobras.com.br') passwordToUse = 'teste3';

    console.log(`[PetroGate RFID] Iniciando Autenticação Supabase para ${email}...`);

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email,
      password: passwordToUse,
    });

    if (authError) {
      console.error(`[PetroGate RFID] ❌ Falha na Senha: ${authError.message}`);
      return null;
    }

    if (authData?.session) {
      console.log(`[PetroGate RFID] ✅ SUCESSO! Logado como ${email}`);
      return authData.session;
    }

    return null;
  } catch (err: any) {
    console.error('[PetroGate RFID] ❌ Erro inesperado:', err.message || err);
    return null;
  }
}
