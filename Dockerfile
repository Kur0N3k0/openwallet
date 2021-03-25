FROM node:latest

RUN useradd -ms /bin/bash kuroneko

USER kuroneko
WORKDIR /app
CMD ["node", "app.js"]