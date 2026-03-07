import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import type { TablesInsert, TablesUpdate } from '../database.types';

// Administrative client configuration (no session persistence)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const getAdminClient = () => createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
    }
});

export interface User {
    id: string;
    name: string;
    email: string;
    isAdmin: boolean;
    isVisitor: boolean;
    isActive: boolean;
    createdAt: string;
    expiresAt?: string;
    isTemp?: boolean;
    canManageTags: boolean;
    isProjetista: boolean;
    projetista?: string;
}

// Utility functions for WebAuthn ArrayBuffer conversion (handles Base64 and Base64URL)
const bufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    // Convert to standard Base64 first
    const base64 = btoa(binary);
    // Convert standard Base64 to Base64URL
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const base64ToBuffer = (data: any): ArrayBuffer => {
    if (!data) return new Uint8Array(0).buffer;

    // If it's already an ArrayBuffer or a View, return the buffer
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) return data.buffer as ArrayBuffer;

    // If it's an array of numbers, treat as byte array
    if (Array.isArray(data)) return new Uint8Array(data).buffer;

    // If it's not a string at this point, we can't 'replace' on it
    if (typeof data !== 'string') {
        console.error('base64ToBuffer expected string/buffer, got:', typeof data, data);
        return new Uint8Array(0).buffer;
    }

    // Convert Base64URL to standard Base64
    let standardBase64 = data.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if missing
    const pad = standardBase64.length % 4;
    if (pad) {
        if (pad === 1) throw new Error('Invalid Base64 string');
        standardBase64 += new Array(5 - pad).join('=');
    }

    const binary = atob(standardBase64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        buffer[i] = binary.charCodeAt(i);
    }
    return buffer.buffer;
};

export const authService = {
    // Register new user
    register: async (name: string, email: string, password: string, isAdmin: boolean = false, isVisitor: boolean = false, canManageTags: boolean = false, isProjetista: boolean = false, projetista: string = ''): Promise<User> => {

        // 1. Create user in Supabase Auth (Using non-persisting client to avoid session swap)
        const adminClient = getAdminClient();
        const { data: authData, error: authError } = await adminClient.auth.signUp({
            email,
            password
        });

        if (authError) throw new Error(`Falha ao registrar autenticação: ${authError.message}`);
        if (!authData.user) throw new Error('Usuário não retornado após registro no Supabase Auth.');

        const userId = authData.user.id;

        // 2. Insert user profile into public.users
        const insertData: TablesInsert<'users'> = {
            id: userId,
            name,
            email,
            password_hash: '[MIGRATED_TO_SUPABASE_AUTH]', // Legacy field
            is_admin: isAdmin,
            is_visitor: isVisitor,
            is_active: true,
            can_manage_tags: canManageTags,
            is_projetista: isProjetista,
            projetista: projetista || null
        };

        const { data, error } = await supabase
            .from('users')
            .insert(insertData)
            .select()
            .single();

        if (error) {
            // Se falhar de inserir no public.users, idealmente deletaríamos do auth.users, 
            // mas o SDK client não permite exclusão direta facilmente.
            throw new Error(`Falha ao criar perfil de usuário: ${error.message}`);
        }

        return {
            id: data.id,
            name: data.name,
            email: data.email,
            isAdmin: data.is_admin ?? false,
            isVisitor: data.is_visitor ?? false,
            isActive: data.is_active ?? true,
            createdAt: data.created_at ?? '',
            expiresAt: data.expires_at ?? undefined,
            isTemp: data.is_temp ?? false,
            canManageTags: data.can_manage_tags ?? false,
            isProjetista: data.is_projetista ?? false
        };
    },

    // Login user
    login: async (identifier: string, password: string): Promise<User> => {
        // 1. Resolve identifier (username or email) to real email from public.users
        const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('*')
            .or(`email.ilike.${identifier},name.ilike.${identifier}`)
            .limit(1)
            .maybeSingle();

        if (profileError || !profile) {
            throw new Error('Usuário ou senha inválidos.');
        }

        if (profile.is_active === false) {
            throw new Error('Conta inativa. Contate o administrador.');
        }

        if (profile.expires_at) {
            const expirationDate = new Date(profile.expires_at);
            if (expirationDate < new Date()) {
                throw new Error('Conta temporária expirada.');
            }
        }

        // 2. Auth with Supabase using the resolved email
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: profile.email,
            password
        });

        if (authError || !authData.user) {
            throw new Error('Usuário ou senha inválidos.');
        }

        return {
            id: profile.id,
            name: profile.name,
            email: profile.email,
            isAdmin: profile.is_admin ?? false,
            isVisitor: profile.is_visitor ?? false,
            isActive: profile.is_active ?? true,
            createdAt: profile.created_at ?? '',
            expiresAt: profile.expires_at ?? undefined,
            isTemp: profile.is_temp ?? false,
            canManageTags: profile.can_manage_tags ?? false,
            isProjetista: profile.is_projetista ?? false,
            projetista: profile.projetista ?? ''
        };
    },

    // Create temporary user
    createTempUser: async (days: number): Promise<{ user: User, passwordRaw: string }> => {
        const tempName = `temp_${Math.random().toString(36).substring(7)}`;
        const tempEmail = `${tempName}@temp.local`;
        const tempPassword = Math.random().toString(36).substring(2, 10);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + days);

        // 1. Create in Supabase Auth (Using non-persisting client to avoid session swap)
        const adminClient = getAdminClient();
        const { data: authData, error: authError } = await adminClient.auth.signUp({
            email: tempEmail,
            password: tempPassword
        });

        if (authError || !authData.user) throw new Error(`Falha ao criar auth temp user: ${authError?.message}`);

        // 2. Insert into public.users
        const insertData: TablesInsert<'users'> = {
            id: authData.user.id,
            name: tempName,
            email: tempEmail,
            password_hash: '[MIGRATED_TO_SUPABASE_AUTH]',
            is_admin: false,
            is_visitor: true,
            is_active: true,
            is_temp: true,
            expires_at: expiresAt.toISOString()
        };

        const { data, error } = await supabase
            .from('users')
            .insert(insertData)
            .select()
            .single();

        if (error) throw new Error(`Falha ao criar perfil temp user: ${error.message}`);

        return {
            user: {
                id: data.id,
                name: data.name,
                email: data.email,
                isAdmin: data.is_admin ?? false,
                isVisitor: data.is_visitor ?? false,
                isActive: data.is_active ?? true,
                createdAt: data.created_at ?? '',
                expiresAt: data.expires_at ?? undefined,
                isTemp: data.is_temp ?? false,
                canManageTags: data.can_manage_tags ?? false,
                isProjetista: data.is_projetista ?? false,
                projetista: data.projetista ?? ''
            },
            passwordRaw: tempPassword
        };
    },

    // Logout user
    logout: async (): Promise<void> => {
        await supabase.auth.signOut();
    },

    // Get current logged in user (Async now because of Supabase session check)
    getCurrentUser: async (): Promise<User | null> => {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
            console.error('Supabase getSession error:', sessionError);
            return null;
        }

        if (!session?.user) {
            console.log('No user session found in getCurrentUser');
            return null;
        }

        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single();

        if (error) {
            console.error('Failed to fetch user profile in getCurrentUser:', error.message);
            return null;
        }
        if (!data) {
            console.error('User profile not found in getCurrentUser for ID:', session.user.id);
            return null;
        }

        if (data.is_active === false) {
            await supabase.auth.signOut();
            return null;
        }

        if (data.expires_at) {
            const expirationDate = new Date(data.expires_at);
            if (expirationDate < new Date()) {
                await supabase.auth.signOut();
                return null;
            }
        }

        return {
            id: data.id,
            name: data.name,
            email: data.email,
            isAdmin: data.is_admin ?? false,
            isVisitor: data.is_visitor ?? false,
            isActive: data.is_active ?? true,
            createdAt: data.created_at ?? '',
            expiresAt: data.expires_at ?? undefined,
            isTemp: data.is_temp ?? false,
            canManageTags: data.can_manage_tags ?? false,
            isProjetista: data.is_projetista ?? false
        };
    },

    // Get all users (admin only)
    getAllUsers: async (): Promise<User[]> => {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw new Error(`Failed to fetch users: ${error.message}`);

        return data.map(row => ({
            id: row.id,
            name: row.name,
            email: row.email,
            isAdmin: row.is_admin ?? false,
            isVisitor: row.is_visitor ?? false,
            isActive: row.is_active ?? true,
            createdAt: row.created_at ?? '',
            expiresAt: row.expires_at ?? undefined,
            isTemp: row.is_temp ?? false,
            canManageTags: row.can_manage_tags ?? false,
            isProjetista: row.is_projetista ?? false,
            projetista: row.projetista ?? ''
        }));
    },

    updateUser: async (userId: string, updates: Partial<{ name: string; email: string; isAdmin: boolean; isVisitor: boolean; isActive: boolean; canManageTags: boolean; isProjetista: boolean; projetista: string; password?: string }>): Promise<void> => {
        const updateData: TablesUpdate<'users'> = {};
        if (updates.name !== undefined) updateData.name = updates.name;
        if (updates.email !== undefined) updateData.email = updates.email;
        if (updates.isAdmin !== undefined) updateData.is_admin = updates.isAdmin;
        if (updates.isVisitor !== undefined) updateData.is_visitor = updates.isVisitor;
        if (updates.isActive !== undefined) updateData.is_active = updates.isActive;
        if (updates.canManageTags !== undefined) updateData.can_manage_tags = updates.canManageTags;
        if (updates.isProjetista !== undefined) updateData.is_projetista = updates.isProjetista;
        if (updates.projetista !== undefined) updateData.projetista = updates.projetista;

        // Atualizar a senha/email no Auth. O SDK cliente só permite atualizar o PRÓPRIO usuário logado.
        const { data: { session } } = await supabase.auth.getSession();
        const isSelf = session?.user?.id === userId;

        if (isSelf) {
            if (updates.password) {
                const { error: authError } = await supabase.auth.updateUser({ password: updates.password });
                if (authError) throw new Error(`Failed to update auth password: ${authError.message}`);
            }

            if (updates.email && updates.email !== session?.user?.email) {
                const { error: emailError } = await supabase.auth.updateUser({ email: updates.email });
                if (emailError) throw new Error(`Failed to update auth email: ${emailError.message}`);
            }
        } else if (updates.password || updates.email) {
            // Se for admin editando outro usuário, não conseguimos mudar no Auth direto pelo client
            console.warn("Alterações de senha ou email para outros usuários afetam apenas a tabela public.users localmente, pois o Auth requer privilégios de Service Role.");
        }

        const { data, error } = await supabase
            .from('users')
            .update(updateData)
            .eq('id', userId)
            .select();

        if (error) throw new Error(`Failed to update user: ${error.message}`);

        if (!data || data.length === 0) {
            throw new Error('A alteração não foi salva. Possível restrição de segurança (RLS).');
        }
    },

    // Update user admin status
    updateUserAdmin: async (userId: string, isAdmin: boolean): Promise<void> => {
        const { error } = await supabase
            .from('users')
            .update({ is_admin: isAdmin })
            .eq('id', userId);

        if (error) throw new Error(`Failed to update user: ${error.message}`);
    },

    // Terminate temporary user immediately
    terminateTempUser: async (userId: string): Promise<void> => {
        const { error } = await supabase
            .from('users')
            .update({
                is_active: false,
                expires_at: new Date().toISOString()
            })
            .eq('id', userId);

        if (error) throw new Error(`Failed to terminate user: ${error.message}`);
    },

    // Delete user
    deleteUser: async (userId: string): Promise<void> => {
        // First check if the user is themselves
        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user.id === userId) {
            throw new Error('Você não pode se excluir do sistema.');
        }

        const { error } = await supabase
            .from('users')
            .delete()
            .eq('id', userId);

        if (error) {
            // Check for Postgres Foreign Key Violation (code 23503)
            if (error.code === '23503') {
                throw new Error('Não é possível excluir este usuário pois existem fotos ou registros vinculados a ele.');
            }
            throw new Error(`Erro ao excluir usuário: ${error.message}`);
        }
    },

    // Biometric Authentication (WebAuthn)
    checkBiometricSupport: (): boolean => {
        return !!(window.PublicKeyCredential &&
            window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
            window.location.protocol === 'https:' || window.location.hostname === 'localhost');
    },

    enrollPasskey: async (): Promise<boolean> => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Usuário não autenticado.');

        // 1. Get registration options from Edge Function
        const { data: options, error: optionsError } = await supabase.functions.invoke('passkey-auth?action=enroll-options', {
            method: 'GET'
        });

        if (optionsError || !options) throw new Error(`Erro ao obter opções de biometria: ${optionsError?.message}`);

        // 2. Adjust options (re-convert bytes)
        const creationOptions: PublicKeyCredentialCreationOptions = {
            ...options,
            user: {
                ...options.user,
                id: base64ToBuffer(options.user.id)
            },
            challenge: base64ToBuffer(options.challenge)
        };

        // 3. Create credential via browser
        const credential = await navigator.credentials.create({ publicKey: creationOptions }) as any;
        if (!credential) throw new Error('Criação de biometria cancelada ou falhou.');

        // 4. Verify with Edge Function
        const { data: verification, error: verifyError } = await supabase.functions.invoke('passkey-auth?action=enroll-verify', {
            method: 'POST',
            body: {
                body: {
                    id: credential.id,
                    rawId: bufferToBase64(credential.rawId),
                    type: credential.type,
                    response: {
                        attestationObject: bufferToBase64(credential.response.attestationObject),
                        clientDataJSON: bufferToBase64(credential.response.clientDataJSON),
                    }
                },
                expectedChallenge: options.challenge
            }
        });

        if (verifyError) {
            throw new Error(`Erro de rede/API ao registrar biometria: ${verifyError?.message}`);
        }

        if (verification && verification.error) {
            throw new Error(verification.error);
        }

        if (!verification || !verification.verified) {
            throw new Error('Falha na verificação da biometria (sem payload válido)');
        }

        return true;
    },

    signInWithPasskey: async (email?: string): Promise<User> => {
        // 1. Get authentication options
        const { data: result, error: optionsError } = await supabase.functions.invoke('passkey-auth?action=login-options', {
            method: 'POST',
            body: { email: email || null }
        });

        if (optionsError || !result) throw new Error(`Erro ao iniciar login biométrico: ${optionsError?.message}`);

        const { options, userId } = result;

        // 2. Adjust options
        const requestOptions: PublicKeyCredentialRequestOptions = {
            ...options,
            challenge: base64ToBuffer(options.challenge),
            allowCredentials: options.allowCredentials?.map((c: any) => ({
                ...c,
                id: base64ToBuffer(c.id)
            }))
        };

        // 3. Get assertion via browser
        const assertion = await navigator.credentials.get({ publicKey: requestOptions }) as any;
        if (!assertion) throw new Error('Login biométrico cancelado.');

        // 4. Verify assertion and get login token
        const { data: verification, error: verifyError } = await supabase.functions.invoke('passkey-auth?action=login-verify', {
            method: 'POST',
            body: {
                body: {
                    id: assertion.id,
                    rawId: bufferToBase64(assertion.rawId),
                    type: assertion.type,
                    response: {
                        authenticatorData: bufferToBase64(assertion.response.authenticatorData),
                        clientDataJSON: bufferToBase64(assertion.response.clientDataJSON),
                        signature: bufferToBase64(assertion.response.signature),
                        userHandle: assertion.response.userHandle ? bufferToBase64(assertion.response.userHandle) : null,
                    }
                },
                expectedChallenge: options.challenge,
                userId
            }
        });

        if (verifyError) {
            throw new Error(`Erro de rede/API no login biométrico: ${verifyError?.message}`);
        }

        if (verification && verification.error) {
            throw new Error(verification.error); // This will show our exact "Verification Failed: ..." message
        }

        if (!verification || !verification.verified) {
            throw new Error('Falha no login biométrico (sem payload válido)');
        }

        // 5. Exchange token for session
        const { data: authData, error: authError } = await supabase.auth.verifyOtp({
            token_hash: verification.token_hash,
            type: 'magiclink'
        });

        if (authError || !authData.user) {
            throw new Error('Falha ao autenticar sessão após biometria.');
        }

        // 6. Fetch full user profile
        const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', authData.user.id)
            .single();

        if (!profile) throw new Error('Perfil do usuário não encontrado.');

        return {
            id: profile.id,
            name: profile.name,
            email: profile.email,
            isAdmin: profile.is_admin ?? false,
            isVisitor: profile.is_visitor ?? false,
            isActive: profile.is_active ?? true,
            createdAt: profile.created_at ?? '',
            expiresAt: profile.expires_at ?? undefined,
            isTemp: profile.is_temp ?? false,
            canManageTags: profile.can_manage_tags ?? false,
            isProjetista: profile.is_projetista ?? false,
            projetista: profile.projetista ?? ''
        };
    }
};
