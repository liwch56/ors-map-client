import { Directions } from '@/support/ors-api-runner'
import OrsParamsParser from '@/support/map-data-services/ors-params-parser'
import toGpx from 'togpx'
import toKml from 'tokml'
import MapViewData from '@/models/map-view-data'
import constants from '@/resources/constants'

export default {
  data: () => ({
    isDownloadModalOpen: false,
    downloadFileName: null,
    dowloadFormat: null,
    defaultDownloadName: 'ors-route'
  }),
  props: {
    mapViewData: {
      Type: MapViewData,
      Required: true
    },
    requestArgs: {
      Type: Object,
      Required: true
    },
    downloadFormatsSupported: {
      Type: Array,
      default: function () {
        return ['json', 'ors-gpx', 'geojson', 'to-gpx', 'gpx', 'kml']
      }
    }
  },
  computed: {
    downloadFormats () {
      return [
        { text: 'ORS JSON', value: 'json', ext: 'json' },
        { text: 'GeoJSON', value: 'geojson', ext: 'json' },
        { text: 'ORS API GPX', value: 'ors-gpx', ext: 'gpx' },
        { text: `${this.$t('download.standard')} GPX`, value: 'to-gpx', ext: 'gpx' },
        { text: 'KML', value: 'kml', ext: 'kml' }
      ]
    },
    /**
     * Return the name of the route first's point
     * @returns string
     */
    originName () {
      const origin = this.mapViewData.places[0]
      return origin ? origin.placeName : ''
    },
    /**
     * Return the name of the route last's point
     * @returns string
     */
    destinationName () {
      const destination = this.mapViewData.places[this.mapViewData.places.length - 1]
      return destination ? destination.placeName : ''
    },
    availableDownloadFormats () {
      const context = this
      const available = this.lodash.filter(this.downloadFormats, (f) => {
        return context.downloadFormatsSupported.includes(f.value)
      })
      return available
    }
  },
  methods: {
    /**
     * Set the default filename and format and open the dowload modal
     */
    openDownload () {
      this.downloadFileName = this.defaultDownloadName
      this.dowloadFormat = this.downloadFormats[0].value
      this.isDownloadModalOpen = true
    },
    /**
     * Close the download modal
     */
    closeDownload () {
      this.isDownloadModalOpen = false
    },
    /**
     * Build the string download content and force a native browser download
     */
    download () {
      const context = this

      this.showInfo(this.$t('download.preparingDownload'), { timeout: 0 })
      this.buildContent().then((content) => {
        // The way to force a native browser download of a string is by
        // creating a hidden anchor and setting its href as a data text
        const link = document.createElement('a')
        link.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content)

        // Check if it has reached the max length
        if (link.href.length > 2097152) {
          this.showError(this.$t('download.fileTooBigToBeDownloaded'), { timeout: 2000 })
        } else {
          // Set the filename
          const timestamp = new Date().getTime()
          const format = context.lodash.find(context.downloadFormats, (df) => { return df.value === context.dowloadFormat })
          // If the file has the default name, add a unique timestamp
          if (this.downloadFileName === this.defaultDownloadName) {
            link.download = `${context.downloadFileName}_${timestamp}.${format.ext}`
          } else {
            link.download = `${context.downloadFileName}.${format.ext}`
          }

          // Fire the download by triggering a click on the hidden anchor
          document.body.appendChild(link)
          link.click()
          link.remove()
          this.showSuccess(this.$t('download.fileReady'), { timeout: 2000 })
          this.closeDownload()
        }
      }).catch(error => {
        console.error(error)
        this.showError(this.$t('download.errorPreparingFile'), { timeout: 2000 })
      })
    },
    /**
     * Build the content to be dowloaded according the format selected
     * When the format is ors-gpx a new request is made using the same
     * args object but changint the format to gpx
     * @returns {Promise}
     */
    buildContent () {
      let jsonData
      const context = this
      return new Promise((resolve, reject) => {
        try {
          if (context.dowloadFormat === 'json') {
            // Get the ORS mapViewData model and stringfy it
            const orsJSONStr = JSON.stringify(this.mapViewData)
            resolve(orsJSONStr)
          } else if (context.dowloadFormat === 'ors-gpx') {
            // If the format is ors-gpx, run anew request with the format being 'gpx'
            context.getORSGpx().then((orsGpx) => {
              resolve(orsGpx)
            }).catch(error => {
              reject(error)
            })
          } else if (context.dowloadFormat === 'to-gpx') {
            const geoJSON = context.mapViewData.getGeoJson()
            // Use the third party utility to convert geojson to gpx
            const togpx = toGpx(geoJSON)
            resolve(togpx)
          } else if (context.dowloadFormat === 'geojson') {
            jsonData = context.mapViewData.getGeoJson()
            const jsonStr = JSON.stringify(jsonData)
            resolve(jsonStr)
          } else if (context.dowloadFormat === 'kml') {
            const routeTitle = context.originName.length > 0 ? `${context.originName} -> ${context.destinationName}` : context.$t('download.documentTitle')
            const kmlOptions = {
              documentName: routeTitle,
              documentDescription: constants.orsKmlDocumentDescription
            }
            jsonData = context.mapViewData.getGeoJson()
            // Use the third party utility to convert geojson to kml
            const tokml = toKml(jsonData, kmlOptions)
            resolve(tokml)
          }
        } catch (error) {
          reject(error)
        }
      })
    },
    /**
     * Get the response data routes and make sure that the geometry format is geojson
     * @returns {Array} of route objects
     */
    getOrsRoutesJson () {
      let orsRoutes = []
      // Retrieve the route data
      if (this.mapViewData && this.mapViewData.routes) {
        orsRoutes = Object.assign({}, this.mapViewData.routes)
      }
      return orsRoutes
    },

    /**
     * Get the ors gpx text running a new request
     * using the same args but changing the format to `gpx`
     * @returns {Promise}
     */
    getORSGpx () {
      const context = this
      return new Promise((resolve, reject) => {
        // Build the args for a directions api request
        let args = OrsParamsParser.buildRoutingArgs(context.mapViewData.places)
        // merge the args with the ones applied in the user request
        args = Object.assign(args, context.mapViewData.rawData.metadata.query)

        // Make sure a gpx format will be returnned
        args.format = 'gpx'

        Directions(context.mapViewData.places, args).then(response => {
          resolve(response.content)
        }).catch(result => {
          console.log(result)
        })
      })
    }
  }
}
