# The only sudo steps (nginx), run once by Bill
```
sudo cp ~/bin/layerling/ops/hundchen/nginx-layerling-dev.conf /etc/nginx/sites-available/layerling-dev.conf
sudo ln -s /etc/nginx/sites-available/layerling-dev.conf /etc/nginx/sites-enabled/layerling-dev.conf
sudo nginx -t && sudo systemctl reload nginx
```
Undo: `sudo rm /etc/nginx/sites-enabled/layerling-dev.conf && sudo nginx -t && sudo systemctl reload nginx`
