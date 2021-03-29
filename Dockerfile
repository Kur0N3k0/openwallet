FROM node:latest

RUN useradd -ms /bin/bash kuroneko
RUN npm install -g nodemon

USER kuroneko
WORKDIR /app
CMD ["nodemon", "app.js"]