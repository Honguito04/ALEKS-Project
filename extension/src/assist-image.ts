/** Imagen elegida por el usuario; conversión local, sin subirla ni conservarla. */
export async function prepareAssistImage(file:File):Promise<string> {
  if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>10*1024*1024)throw Error('Elige una imagen PNG, JPEG o WebP de hasta 10 MB.');
  let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(file);}catch{throw Error('No se pudo abrir la imagen. Guarda una captura PNG o JPEG y vuelve a elegirla.');}
  try {
    if(!bitmap.width || !bitmap.height || bitmap.width*bitmap.height>25_000_000)throw Error('La imagen es demasiado grande; recorta el ejercicio antes de adjuntarla.');
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
    if(!context)throw Error('No se pudo preparar la imagen en este navegador.');
    let scale=Math.min(1,2048/bitmap.width,2048/bitmap.height);
    for(let attempt=0;attempt<4;attempt++) {
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const image=canvas.toDataURL('image/jpeg',.85);
      if(image.length<=1_300_000)return image;
      scale*=.75;
    }
    throw Error('La imagen sigue siendo demasiado grande; recorta únicamente el ejercicio.');
  }finally{bitmap.close();}
}
