import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader, Marker, Polyline, InfoWindow } from "@react-google-maps/api";
import { getDayColor } from "../../utils/colors";
import { categoryIcon } from "../../utils/formatters";
import { splitByGap } from "../../utils/geo";
import { useLanguage } from "../../i18n/LanguageContext";

const LIGHT_MAP_STYLE = [
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#747474" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#eeeeee" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#777777" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9e4f0" }] },
];

const MAP_OPTIONS = {
  styles: LIGHT_MAP_STYLE,
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: true,
};

// Custom SVG path for hotel marker (house/building shape)
const HOTEL_ICON_PATH =
  "M-8,8 L-8,-2 L0,-8 L8,-2 L8,8 Z M-4,8 L-4,2 L0,2 L0,8 Z M3,-1 L6,-1 L6,2 L3,2 Z";

const HOTEL_COLOR = "#111111"; // black — stands out from all day colors

// Dashed line icon for hotel-to-attraction polylines
const DASH_SYMBOL = {
  path: "M 0,-1 0,1",
  strokeOpacity: 1,
  strokeWeight: 2,
  scale: 3,
};

export default function TripMap({
  dayPlans,
  selectedDayNumber,
  selectedItemId,
  hoveredItemId,
  onMarkerClick,
  hotelLodgings = [],
}) {
  const { t } = useLanguage();
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY || "",
  });

  const mapRef = useRef(null);
  const [infoItem, setInfoItem] = useState(null);
  const [hotelInfo, setHotelInfo] = useState(null);

  const allItems = dayPlans.flatMap((dp) => {
    const items = (dp.itinerary_items || []).filter((item) => item.latitude && item.longitude);
    return items.map((item, idx) => ({ ...item, day_number: dp.day_number, day_index: idx + 1 }));
  });

  const visibleItems = selectedDayNumber
    ? allItems.filter((item) => item.day_number === selectedDayNumber)
    : allItems;

  // All points for bounds: visible items + hotels
  const allBoundsPoints = [
    ...visibleItems.map((i) => ({ lat: parseFloat(i.latitude), lng: parseFloat(i.longitude) })),
    ...hotelLodgings.map((h) => ({ lat: parseFloat(h.latitude), lng: parseFloat(h.longitude) })),
  ];

  const onMapLoad = useCallback(
    (map) => {
      mapRef.current = map;
      fitBounds(map, allBoundsPoints);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (mapRef.current && allBoundsPoints.length > 0) {
      fitBounds(mapRef.current, allBoundsPoints);
    }
  }, [selectedDayNumber, allBoundsPoints.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function fitBounds(map, points) {
    if (!points.length) return;
    const bounds = new window.google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, { padding: 60 });
  }

  // Build dashed lines from hotel to first/last items of selected day
  const hotelDashLines = [];
  if (selectedDayNumber && hotelLodgings.length > 0) {
    const hotel = hotelLodgings[0]; // primary hotel
    const hotelPos = { lat: parseFloat(hotel.latitude), lng: parseFloat(hotel.longitude) };
    const dayItems = visibleItems
      .filter((i) => i.day_number === selectedDayNumber)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    if (dayItems.length > 0) {
      const firstItem = dayItems[0];
      const lastItem = dayItems[dayItems.length - 1];
      hotelDashLines.push({
        key: `hotel-first-${firstItem.id}`,
        path: [
          hotelPos,
          { lat: parseFloat(firstItem.latitude), lng: parseFloat(firstItem.longitude) },
        ],
      });
      if (lastItem.id !== firstItem.id) {
        hotelDashLines.push({
          key: `hotel-last-${lastItem.id}`,
          path: [
            hotelPos,
            { lat: parseFloat(lastItem.latitude), lng: parseFloat(lastItem.longitude) },
          ],
        });
      }
    }
  }

  if (!isLoaded) {
    return (
      <div className="w-full h-full bg-gray-50 flex items-center justify-center text-gray-400">
        {t("map.loading")}
      </div>
    );
  }

  if (!process.env.REACT_APP_GOOGLE_MAPS_API_KEY) {
    return (
      <div className="w-full h-full bg-gray-50 flex items-center justify-center text-gray-400 p-8 text-center text-sm">
        <div>
          <p className="mb-2 font-medium text-gray-500">{t("map.noApiKey")}</p>
          <p>{t("map.noApiKeyHint")}</p>
        </div>
      </div>
    );
  }

  const defaultCenter =
    allBoundsPoints.length > 0
      ? allBoundsPoints[0]
      : { lat: 35.6762, lng: 139.6503 };

  return (
    <GoogleMap
      mapContainerClassName="w-full h-full min-h-[400px]"
      center={defaultCenter}
      zoom={12}
      options={MAP_OPTIONS}
      onLoad={onMapLoad}
    >
      {/* Attraction markers */}
      {visibleItems.map((item) => {
        const color = getDayColor(item.day_number);
        const isActive = selectedItemId === item.id || hoveredItemId === item.id;

        return (
          <Marker
            key={item.id}
            position={{
              lat: parseFloat(item.latitude),
              lng: parseFloat(item.longitude),
            }}
            label={{
              text: String(item.day_index),
              color: "#fff",
              fontSize: isActive ? "14px" : "11px",
              fontWeight: "bold",
            }}
            icon={{
              path: window.google.maps.SymbolPath.CIRCLE,
              fillColor: color,
              fillOpacity: 1,
              strokeColor: isActive ? "#fff" : color,
              strokeWeight: isActive ? 3 : 1,
              scale: isActive ? 16 : 12,
            }}
            onClick={() => {
              onMarkerClick(item);
              setInfoItem(item);
              setHotelInfo(null);
            }}
            zIndex={isActive ? 998 : 1}
          />
        );
      })}

      {/* Hotel markers — always visible */}
      {hotelLodgings.map((hotel) => (
        <Marker
          key={`hotel-${hotel.id}`}
          position={{
            lat: parseFloat(hotel.latitude),
            lng: parseFloat(hotel.longitude),
          }}
          icon={{
            path: HOTEL_ICON_PATH,
            fillColor: HOTEL_COLOR,
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2.5,
            scale: 1.4,
            anchor: window.google?.maps ? new window.google.maps.Point(0, 0) : undefined,
          }}
          onClick={() => {
            setHotelInfo(hotel);
            setInfoItem(null);
          }}
          zIndex={999}
          title={hotel.name}
        />
      ))}

      {/* Route lines per day — split into sub-segments when consecutive
          items are >80km apart. The long-distance hop between segments
          becomes a dashed line (transport) with a ✈️ icon at midpoint,
          so a multi-city day never draws a solid 700km line across the
          map like a walking path. */}
      {dayPlans
        .filter((dp) => !selectedDayNumber || dp.day_number === selectedDayNumber)
        .flatMap((dp) => {
          const items = (dp.itinerary_items || [])
            .filter((i) => i.latitude && i.longitude)
            .sort((a, b) => a.position - b.position);
          if (items.length < 2) return [];

          const { segments, transports } = splitByGap(items);
          const color = getDayColor(dp.day_number);
          const nodes = [];

          segments.forEach((seg, idx) => {
            if (seg.length < 2) return;
            nodes.push(
              <Polyline
                key={`route-${dp.id}-${idx}-${seg.map((p) => p.item.id).join(",")}`}
                path={seg.map((p) => ({ lat: p.lat, lng: p.lng }))}
                options={{
                  strokeColor: color,
                  strokeOpacity: 0.6,
                  strokeWeight: 3,
                }}
              />,
            );
          });

          transports.forEach((t, idx) => {
            const path = [
              { lat: t.from.lat, lng: t.from.lng },
              { lat: t.to.lat, lng: t.to.lng },
            ];
            nodes.push(
              <Polyline
                key={`transport-${dp.id}-${idx}`}
                path={path}
                options={{
                  strokeOpacity: 0,
                  strokeWeight: 0,
                  icons: [
                    {
                      icon: {
                        path: "M 0,-1 0,1",
                        strokeOpacity: 1,
                        strokeColor: color,
                        strokeWeight: 2,
                        scale: 3,
                      },
                      offset: "0",
                      repeat: "12px",
                    },
                  ],
                }}
              />,
            );
            const midLat = (t.from.lat + t.to.lat) / 2;
            const midLng = (t.from.lng + t.to.lng) / 2;
            nodes.push(
              <Marker
                key={`transport-icon-${dp.id}-${idx}`}
                position={{ lat: midLat, lng: midLng }}
                icon={{
                  // Data-URL SVG emoji pin so we don't depend on google maps
                  // spritesheet. Slightly offset anchor so it sits above line.
                  url:
                    "data:image/svg+xml;utf-8," +
                    encodeURIComponent(
                      `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
                        <circle cx="14" cy="14" r="12" fill="white" stroke="${color}" stroke-width="2"/>
                        <text x="14" y="19" text-anchor="middle" font-size="14">✈️</text>
                      </svg>`,
                    ),
                  scaledSize: { width: 28, height: 28 },
                  anchor: { x: 14, y: 14 },
                }}
                clickable={false}
                zIndex={0}
              />,
            );
          });

          return nodes;
        })}

      {/* Dashed lines from hotel to first/last items of selected day */}
      {hotelDashLines.map((line) => (
        <Polyline
          key={line.key}
          path={line.path}
          options={{
            strokeOpacity: 0,
            strokeWeight: 0,
            icons: [
              {
                icon: { ...DASH_SYMBOL, strokeColor: HOTEL_COLOR },
                offset: "0",
                repeat: "14px",
              },
            ],
          }}
        />
      ))}

      {/* Attraction info window */}
      {infoItem && (
        <InfoWindow
          position={{
            lat: parseFloat(infoItem.latitude),
            lng: parseFloat(infoItem.longitude),
          }}
          onCloseClick={() => setInfoItem(null)}
        >
          <div className="text-gray-900 max-w-[200px]">
            <p className="font-bold text-sm">
              {categoryIcon(infoItem.category)} {infoItem.name}
            </p>
            {infoItem.google_rating && (
              <p className="text-xs text-gray-600 mt-1">
                Rating: {infoItem.google_rating} / 5
              </p>
            )}
            {infoItem.time_slot && (
              <p className="text-xs text-gray-600">Time: {infoItem.time_slot}</p>
            )}
          </div>
        </InfoWindow>
      )}

      {/* Hotel info window */}
      {hotelInfo && (
        <InfoWindow
          position={{
            lat: parseFloat(hotelInfo.latitude),
            lng: parseFloat(hotelInfo.longitude),
          }}
          onCloseClick={() => setHotelInfo(null)}
        >
          <div className="text-gray-900 max-w-[220px]">
            <p className="font-bold text-sm">
              🏨 {hotelInfo.name}
            </p>
            {hotelInfo.address && (
              <p className="text-xs text-gray-500 mt-1">{hotelInfo.address}</p>
            )}
            {hotelInfo.google_rating && (
              <p className="text-xs text-yellow-600 mt-1">
                {"★"} {hotelInfo.google_rating} / 5
              </p>
            )}
          </div>
        </InfoWindow>
      )}
    </GoogleMap>
  );
}
