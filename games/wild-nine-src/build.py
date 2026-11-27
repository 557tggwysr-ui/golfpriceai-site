import json
t=open('template.html').read()
t=t.replace('/*ENGINE*/',open('engine.js').read()).replace('/*QUIPS*/',open('quips.js').read()).replace('/*KIT*/',json.dumps(json.load(open('kit.json')),separators=(',',':'))).replace('/*SHOPP*/',json.dumps(json.load(open('shopprices.json')),separators=(',',':'))).replace('/*PROMO*/',json.dumps(json.load(open('promo.json')),separators=(',',':'))).replace('/*UI*/',open('ui.js').read())
open('index.html','w').write(t)

# a test copy for John: unlimited Birdies, every monthly drop in the shop now
tt=t.replace('<body>','<body><div class="testban">TEST COPY · UNLIMITED BIRDIES · NOT FOR SHARING</div><script>window.WN_TEST=true</script>',1)
assert tt!=t
open('index-test.html','w').write(tt.replace('<title>Wild Nine · GolfPrice AI</title>','<title>Wild Nine TEST · GolfPrice AI</title>'))
