import { Injectable, Logger } from '@nestjs/common';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

export interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ChatResult {
  content: string;
  toolCalls: OllamaToolCall[];
}

/**
 * Cliente del modelo local (Ollama) expuesto por el Cloudflare Tunnel en la PC
 * casera. Autentica con un Service Token de Cloudflare Access. Nunca lanza en un
 * fallo de red: la IA es un "plus", así que el llamador degrada limpiamente.
 */
@Injectable()
export class AiAssistantClient {
  private readonly logger = new Logger(AiAssistantClient.name);
  private readonly baseUrl = (process.env.AI_BASE_URL || '').replace(/\/$/, '');
  private readonly model = process.env.AI_MODEL || 'qwen2.5:7b-instruct-q4_K_M';
  private readonly accessId = process.env.AI_ACCESS_CLIENT_ID || '';
  private readonly accessSecret = process.env.AI_ACCESS_CLIENT_SECRET || '';

  get configured(): boolean {
    return Boolean(this.baseUrl);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.accessId && this.accessSecret) {
      h['CF-Access-Client-Id'] = this.accessId;
      h['CF-Access-Client-Secret'] = this.accessSecret;
    }
    return h;
  }

  /** ¿El modelo está accesible ahora mismo? (PC prendida + túnel arriba). */
  async health(): Promise<boolean> {
    if (!this.configured) return false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${this.baseUrl}/api/version`, { headers: this.headers(), signal: ctrl.signal });
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Una ronda de chat con el modelo. Devuelve el texto y/o las llamadas a
   * herramientas que pide el modelo. Timeout amplio porque en CPU/GPU modesta
   * una respuesta puede tardar.
   */
  async chat(messages: ChatMessage[], tools: OllamaTool[]): Promise<ChatResult> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.headers(),
        signal: ctrl.signal,
        body: JSON.stringify({ model: this.model, messages, tools, stream: false, options: { temperature: 0.2 } }),
      });
      if (!res.ok) {
        throw new Error(`Modelo respondió ${res.status}`);
      }
      const data = (await res.json()) as { message?: { content?: string; tool_calls?: OllamaToolCall[] } };
      return {
        content: data.message?.content ?? '',
        toolCalls: data.message?.tool_calls ?? [],
      };
    } finally {
      clearTimeout(t);
    }
  }
}
