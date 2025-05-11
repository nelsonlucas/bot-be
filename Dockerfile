FROM node:20-alpine

# Define diretório de trabalho
WORKDIR /app

# Copia apenas os arquivos de dependência para instalar primeiro (melhora o cache)
COPY package*.json ./

# Instala as dependências
RUN npm install --legacy-peer-deps

# Copia o restante do código-fonte
COPY . .

# Compila o projeto
RUN npm run build

# Expõe a porta
EXPOSE 8081

# Comando de inicialização
CMD ["npm", "run", "start"]
