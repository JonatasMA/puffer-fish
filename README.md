# Puffer Fish 🐡

**Puffer Fish** é uma extensão para VS Code projetada para ajudar na refatoração e migração rápida dos padrões de código antigos do CRM para os padrões novos.

## 🚀 Funcionalidades Principais

A extensão identifica trechos de código legados no seu arquivo PHP e aplica a substituição automática para a sintaxe moderna recomendada. Um dos grandes diferenciais é que a extensão **resolve e injeta automaticamente os imports (`use`)**, garantindo que as classes requeridas sejam importadas no topo do arquivo (logo após o `namespace`) e evitando qualquer duplicação de pacotes já importados.

### Padrões Suportados:

1. **`Container::get`**
   - **De:** `Container::get('chave_do_servico')`
   - **Para:** `(new ClasseMapeada)`
   - *Utiliza o mapeamento definido em `./crm/src/dependencias.json`*

2. **`ConteinerEntidade::getInstancia`**
   - **De:** `ConteinerEntidade::getInstancia('chave_da_entidade')`
   - **Para:** `(new EntidadeMapeada)`
   - *Utiliza o mapeamento definido em `./crm/src/entidades/Entidades.json`*

3. **`getCampo` (Mensagens e arrays)**
   - **De:** `$var->getCampo('NOME_INPUT')->get('valor')`
   - **Para:** `$var['NOME_INPUT']`

4. **`setCampo` (Atribuições)**
   - **De:** `$var->setCampo('NOME_INPUT', VALOR_INPUT);`
   - **Para:** `$var['NOME_INPUT'] = VALOR_INPUT`

---

## ⌨️ Comandos Globais Disponíveis

Para refatorar um arquivo grande de maneira rápida, você pode invocar comandos que percorrem todo o documento atual e aplicam as alterações em lote.

Acesse a **Paleta de Comandos** (`Ctrl+Shift+P` no Windows/Linux ou `Cmd+Shift+P` no Mac) e digite um dos comandos abaixo:

| Comando na Paleta | ID do Comando (Keybinds) | Descrição |
| :--- | :--- | :--- |
| **PufferFish::ReclaceContainerGet** | `extension.replaceContainerGet` | Substitui simultaneamente TODAS as ocorrências de `Container::get` isoladamente. |
| **PufferFish::ReclaceConteinerEntidade** | `extension.replaceConteinerEntidade` | Substitui TODAS as ocorrências de `ConteinerEntidade::getInstancia`. |
| **PufferFish::ReplaceGetMsg** | `extension.replaceGetCampo` | Altera todos os padrões do método `getCampo`. |
| **PufferFish::ReplaceSetMsg** | `extension.replaceSetCampo` | Altera todos os padrões do método `setCampo`. |
| **PufferFish::ReplaceAll** | `extension.replaceAllPatterns` | **Substitui TODOS os padrões suportados de uma única vez** no arquivo atual. |

> **Dica:** O mecanismo de refatoração em lote (*bulk replacements*) é super seguro com imports. Se 10 substituições no arquivo exigirem a classe `App\Services\Produto`, a extensão vai importar `App\Services\Produto` apenas uma única vez.

---

## 🖱️ Refatoração Local via Hover

Você também pode utilizar as funcionalidades de forma pontual (linha a linha) graças ao modo Hover nativo:
- Passe o mouse sobre a chave/string literal dentro dos métodos (ex: passe o mouse sobre `'chave_do_servico'`).
- O VS Code exibirá uma notificação automática perguntando se você deseja substituir a declaração alvo.
- Ao clicar em "Yes", a extensão efetua a troca na hora.
