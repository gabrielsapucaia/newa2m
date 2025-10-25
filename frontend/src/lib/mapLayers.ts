type MapStyle = "street" | "satellite";

type LayerConfig = {
  key: MapStyle;
  name: string;
  url: string;
  attribution: string;
};

export const MAP_LAYERS: Record<MapStyle, LayerConfig> = {
  street: {
    key: "street",
    name: "Street",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  satellite: {
    key: "satellite",
    name: "Satélite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      'Tiles © <a href="https://www.esri.com/">Esri</a> — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, ' +
      "Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
  },
};

export type { MapStyle, LayerConfig };
