import axios from "axios";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import ImageModule from "docxtemplater-image-module-free";
import { imageSize as sizeOf } from "image-size";

export function getHttpData(url: string, token = ""): Promise<ArrayBuffer> {
  const headers = token ? { Authorization: `Zoho-oauthtoken ${token}` } : {};
  return axios.get(url, { responseType: "arraybuffer", headers }).then(r => r.data);
}

export async function populateDataOnDocx({
  json, file,
}: { json: any; file: Buffer; }): Promise<Buffer> {
  const opts: any = {
    centered: false,
    fileType: "docx",
    getImage: (tagObj: any) => getHttpData(tagObj.link),
    getSize: (img: Buffer, tagObj: any) => {
      const { width = 1, height = 1 } = sizeOf(img);
      const maxW = Math.min(tagObj.maxWidth || width, width);
      const newW = maxW;
      const newH = Math.round((height / width) * newW);
      return [newW, newH];
    },
  };

  const imageModule = new ImageModule(opts);
  const zip = new PizZip(file);

  const doc = new Docxtemplater(zip, {
    modules: [imageModule],
    paragraphLoop: true,
    linebreaks: true,
  });

  await doc.renderAsync(json);

  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}
