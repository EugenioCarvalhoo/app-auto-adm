-- Limite diário de leituras de boleto por IA (contador por usuário e dia)

CREATE TABLE IF NOT EXISTS boletos_extracoes_uso (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    dia DATE NOT NULL,
    total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (usuario_id, dia)
);

COMMENT ON TABLE boletos_extracoes_uso IS
    'Contador de leituras de boleto por IA por usuário e dia. dia = data de São Paulo calculada pela aplicação (DATE sem fuso).';
